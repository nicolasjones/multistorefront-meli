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

const COTIZACION_VALIDA = /^\d{1,10}([.,]\d{1,4})?$/

const formatoPesos = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
const formatoDolares = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const formatoMargen = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 })

export const formatearPesosPrecio = (valor: number) => `$ ${formatoPesos.format(valor)}`
export const formatearDolares = (valor: number) => `USD ${formatoDolares.format(valor)}`

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

// Cotización escrita por el Administrador: coma o punto decimal, hasta 4 decimales (numeric(14,4)).
export function parsearCotizacion(texto: string): number | null {
  const limpio = texto.trim()
  if (!COTIZACION_VALIDA.test(limpio)) return null
  const valor = Number(limpio.replace(',', '.'))
  return valor > 0 ? valor : null
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
