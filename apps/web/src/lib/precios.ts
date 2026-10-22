import type { SupabaseClient } from '@supabase/supabase-js'
import { parsearImporte } from './productos'

// Precio y costo en pesos o dólares (F-PRE-01, FR-001…FR-006). La autoridad es la base
// (migraciones 20261022120000…120300: `private.a_pesos`, vista `productos_precio_costo`);
// acá se espeja SOLO la conversión para la vista previa mientras se escribe en el formulario
// (el producto todavía no se guardó). No se guarda ningún importe en pesos.

export type Cotizacion = {
  // Pesos por dólar (numeric(14,4)); la base la entrega como número o texto.
  valor: number
  // Instante del último cambio de valor (timestamptz ISO).
  fecha: string
}

export const AVISO_CARGAR_COTIZACION = 'Cargá la cotización'
export const NOTA_SIN_IVA = 'El precio de lista se carga sin IVA.'
export const NOTA_MARGEN = 'Margen = Precio − Costo − Comisión del canal. El precio es central para todas las stores.'

const formatoPesos = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
const formatoMargen = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 })

export const formatearPesosPrecio = (valor: number) => `$ ${formatoPesos.format(valor)}`

// «vie 25/09» (hint del prototipo). Hora de Buenos Aires para no correr el día según el navegador.
export function formatearFechaCotizacion(iso: string): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return ''
  const partes = new Intl.DateTimeFormat('es-AR', {
    weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'America/Argentina/Buenos_Aires',
  }).formatToParts(fecha)
  const buscar = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? ''
  return `${buscar('weekday').replace('.', '')} ${buscar('day')}/${buscar('month')}`
}

// Margen como porcentaje: 0,4 → «40 %»; sin dato → «—».
export const formatearMargen = (margen: number | null) => (margen === null ? '—' : `${formatoMargen.format(margen * 100)} %`)

// USD × cotización con el mismo redondeo que `round(x, 2)` de la base (mitad hacia arriba, en
// enteros para no arrastrar error de coma flotante). ARS queda igual; USD sin cotización → null.
export function aPesos(importe: number, moneda: 'USD' | 'ARS', cotizacion: number | null): number | null {
  if (moneda === 'ARS') return importe
  if (cotizacion === null) return null
  const centavos = BigInt(Math.round(importe * 100))
  const diezMilesimas = BigInt(Math.round(cotizacion * 10_000))
  return Number((centavos * diezMilesimas + 5000n) / 10_000n) / 100
}

export type ResumenPrecios = {
  // Precio de lista en pesos sin IVA; null si falta la lista, es inválida o falta la cotización.
  precioArs: number | null
  costoArs: number | null
  // (neto − costo) / neto, redondeado a 4 decimales como la base; null sin ambos importes.
  margen: number | null
}

export function resumirPrecios(
  entrada: { moneda: 'USD' | 'ARS'; precioLista: string; costo: string },
  cotizacion: number | null,
): ResumenPrecios {
  const lista = parsearImporte(entrada.precioLista)
  const costo = parsearImporte(entrada.costo)
  const precioArs = lista !== null && lista > 0 ? aPesos(lista, entrada.moneda, cotizacion) : null
  const costoArs = costo !== null ? aPesos(costo, entrada.moneda, cotizacion) : null
  const margen =
    precioArs !== null && precioArs > 0 && costoArs !== null ? Math.round(((precioArs - costoArs) / precioArs) * 10_000) / 10_000 : null
  return { precioArs, costoArs, margen }
}

export async function leerCotizacionInicial(cliente: SupabaseClient): Promise<Cotizacion | null> {
  const { data, error } = await cliente
    .schema('dominio')
    .from('cotizacion_inicial')
    .select('valor, updated_at')
    .maybeSingle<{ valor: number | string; updated_at: string }>()
  if (error) throw error
  return data ? { valor: Number(data.valor), fecha: data.updated_at } : null
}

// Sin consumidor en la UI hasta MSF-116 (carga de cotización, botón «Cotización →»); lo pide T006.
export async function fijarCotizacionInicial(cliente: SupabaseClient, valor: number): Promise<void> {
  const { error } = await cliente.rpc('fijar_cotizacion_inicial', { p_valor: valor })
  if (error) throw error
}

// El mensaje crudo de Postgres puede nombrar políticas o columnas: al usuario va solo el
// texto en castellano y el detalle queda en consola.
export function mensajeErrorCotizacion(error: unknown): string {
  console.error('No pudimos guardar la cotización.', error)
  const code = (error as { code?: string } | null)?.code
  if (code === '42501') return 'Solo el Administrador puede cargar la cotización. Puede que tu rol haya cambiado: recargá la página.'
  if (code === '23514') return 'Ingresá una cotización mayor a cero, con hasta 4 decimales.'
  if (code === '22003') return 'La cotización es demasiado grande. Revisá el valor.'
  return 'No pudimos guardar la cotización. Probá de nuevo.'
}

// ============================================================================
// Regla de precio por empresa (F-PRE-07, FR-008…FR-014)
// ============================================================================
// La autoridad es la base (`dominio.precios_empresa`, `guardar_regla_precio_empresa`,
// `previsualizar_precios_empresa`): la pantalla no recalcula, lee la vista previa del servidor.

export type BaseRegla = 'central' | 'central_ajuste'

export const BASES_REGLA: { valor: BaseRegla; etiqueta: string }[] = [
  { valor: 'central', etiqueta: 'Igual al central' },
  { valor: 'central_ajuste', etiqueta: 'Central con ajuste' },
]

export const TEXTO_REDONDEO = 'Al $ 10 más cercano'
export const AYUDA_AJUSTE = 'Negativo para bajar, positivo para subir. Ej.: −5 o 8.'
export const AVISO_REGLA_GUARDADA = 'Precios de la empresa guardados'

export type ReglaPrecio = {
  base: BaseRegla
  ajustePct: number
  // `updated_at` leído, para el bloqueo optimista; null = la empresa aún no tiene regla.
  actualizadoEn: string | null
}

// Empresa sin regla guardada ≡ «Igual al central».
export const REGLA_SIN_GUARDAR: ReglaPrecio = { base: 'central', ajustePct: 0, actualizadoEn: null }

type FilaRegla = { base: BaseRegla; ajuste_pct: number | string; updated_at: string }

const aRegla = (fila: FilaRegla): ReglaPrecio => ({
  base: fila.base,
  ajustePct: Number(fila.ajuste_pct),
  actualizadoEn: fila.updated_at,
})

export async function leerReglaPrecioEmpresa(cliente: SupabaseClient, empresaId: string): Promise<ReglaPrecio> {
  const { data, error } = await cliente
    .schema('dominio')
    .from('precios_empresa')
    .select('base, ajuste_pct, updated_at')
    .eq('empresa_id', empresaId)
    .maybeSingle<FilaRegla>()
  if (error) throw error
  return data ? aRegla(data) : REGLA_SIN_GUARDAR
}

export async function guardarReglaPrecioEmpresa(
  cliente: SupabaseClient,
  empresaId: string,
  regla: { base: BaseRegla; ajustePct: number },
  actualizadoEn: string | null,
): Promise<ReglaPrecio> {
  const { data, error } = await cliente
    .rpc('guardar_regla_precio_empresa', {
      p_empresa: empresaId,
      p_base: regla.base,
      p_ajuste_pct: regla.ajustePct,
      p_updated_at: actualizadoEn,
    })
    .single<FilaRegla>()
  if (error) throw error
  return aRegla(data)
}

export type FilaPrevia = {
  productoId: string
  nombre: string
  sku: string | null
  moneda: 'USD' | 'ARS'
  // null = sin precio (USD sin cotización cargada).
  centralArs: number | null
  netoArs: number | null
}

type FilaPreviaBase = {
  producto_id: string
  nombre: string
  sku: string | null
  moneda: 'USD' | 'ARS'
  central_ars: number | string | null
  neto_ars: number | string | null
}

const aNumeroONulo = (valor: number | string | null) => (valor === null ? null : Number(valor))

export async function previsualizarPreciosEmpresa(
  cliente: SupabaseClient,
  empresaId: string,
  base: BaseRegla,
  ajustePct: number,
): Promise<FilaPrevia[]> {
  const { data, error } = await cliente.rpc('previsualizar_precios_empresa', {
    p_empresa: empresaId,
    p_base: base,
    p_ajuste_pct: ajustePct,
  })
  if (error) throw error
  return ((data ?? []) as FilaPreviaBase[]).map((fila) => ({
    productoId: fila.producto_id,
    nombre: fila.nombre,
    sku: fila.sku,
    moneda: fila.moneda,
    centralArs: aNumeroONulo(fila.central_ars),
    netoArs: aNumeroONulo(fila.neto_ars),
  }))
}

// «8», «-5», «−5», «+8», «8,5» → número; cualquier otra cosa (letras, más de 3 decimales) → null.
export function parsearAjuste(texto: string): number | null {
  const limpio = texto.trim().replace('−', '-').replace(',', '.')
  if (!/^[+-]?\d+(\.\d{1,3})?$/.test(limpio)) return null
  // En es-AR el punto es de miles: «1.234» no es 1,234 (lo dice el texto de ayuda: se escribe con coma).
  if (/\.\d{3}$/.test(limpio) && !texto.includes(',')) return null
  return Number(limpio)
}

// Mensaje del campo (o undefined si es válido). Con «Igual al central» el ajuste no rige.
export function validarAjuste(base: BaseRegla, texto: string): string | undefined {
  if (base === 'central') return undefined
  if (texto.trim() === '') return 'Ingresá el ajuste en %. Ej.: −5 o 8.'
  const valor = parsearAjuste(texto)
  if (valor === null) return 'Ingresá un número válido, con hasta 3 decimales. Usá coma para los decimales.'
  if (valor <= -100) return 'El ajuste debe ser mayor a −100 %.'
  if (Math.abs(valor) >= 10_000) return 'El ajuste es demasiado grande.'
  return undefined
}

// Ajuste guardado → texto del campo (coma decimal, como en es-AR).
export const ajusteATexto = (ajustePct: number) => String(ajustePct).replace('.', ',')

// El mensaje crudo de Postgres puede nombrar políticas o columnas: al usuario va solo el
// texto en castellano y el detalle queda en consola.
export function mensajeErrorRegla(error: unknown): string {
  console.error('No pudimos guardar los precios de la empresa.', error)
  const code = (error as { code?: string } | null)?.code
  if (code === '42501') return 'Solo el Administrador puede editar los precios de la empresa. Puede que tu rol haya cambiado: recargá la página.'
  if (code === '40001') return 'Otra persona modificó los precios de esta empresa. Recargá para ver los cambios y volvé a intentar.'
  if (code === '23514') return 'Revisá el ajuste: tiene que ser mayor a −100 %, con hasta 3 decimales.'
  if (code === '22003') return 'El ajuste es demasiado grande. Revisá el valor.'
  if (code === 'P0002') return 'La empresa ya no existe en tu organización.'
  return 'No pudimos guardar los precios de la empresa. Probá de nuevo.'
}
