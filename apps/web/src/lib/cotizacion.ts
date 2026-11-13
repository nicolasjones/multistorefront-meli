import type { SupabaseClient } from '@supabase/supabase-js'
import { formatearFechaCotizacion, formatearPesosPrecio } from './precios'

// Carga diaria de la cotización del dólar (F-PRE-02, MSF-246) y su confirmación (F-PRE-03, MSF-267).
// La autoridad es la base (migraciones 20261023140000, 20261023140100, 20261023140200 y 20261023140300:
// `cargar_cotizacion`, `estado_cotizacion`, `previsualizar_cotizacion`, `confirmar_cotizacion`,
// `descartar_cotizacion`); acá se espeja SOLO el parseo y la variación para dar feedback mientras se escribe.

// Valores del lanzamiento (F-PRE-06 los vuelve configurables): lo que rige mientras la base no informe otra cosa.
// Alerta «Variación inusual» (FR-007): la pantalla avisa y, por encima de este porcentaje, la base EXIGE la confirmación
// explícita: `confirmar_cotizacion(…, p_variacion_vista)` exige la variación que el usuario VIO y que coincida con la real
// (22023, hint `variacion_inusual` si falta y `variacion_cambio` si el dólar cambió mientras revisaba); no se aplica sin ella.
export const UMBRAL_VARIACION_INUSUAL_PCT = 15

export type AlcanceCotizacion = 'sistema' | 'empresa'

export const MENSAJE_VALOR_INVALIDO = 'Ingresá un valor válido, por ejemplo 1490 o 1490,50.'

export type CotizacionVigente = {
  valor: number
  cargadaEn: string
  // null cuando la vigente es la cotización inicial (nadie la «cargó» en esta pantalla).
  cargadaPor: string | null
}

export type EstadoCotizacion = {
  vigente: CotizacionVigente | null
  // Cotización APLICADA (la que usan los precios); puede diferir de la última carga si esta quedó bajo el umbral.
  // null si la base no la informa o el rol no puede leerla: ahí rige `vigente`.
  aplicada: number | null
  productosUsd: number
  pendiente: { valor: number; expiraEn: string } | null
  // F-PRE-06: lo configurado (la base lo informa con cada lectura; sin dato, los valores del lanzamiento).
  alcance: AlcanceCotizacion
  umbralPct: number
  confirmacionPct: number
  redondeoPesos: number
}

export type CotizacionCargada = {
  valor: number
  anterior: number | null
  variacionPct: number | null
  expiraEn: string
}

// «¿Se cargó el dólar hoy?» (F-PRE-05, FR-019): carga CONFIRMADA con fecha de hoy en Buenos Aires.
export type CotizacionDelDia = {
  cargadaHoy: boolean
  cargadaEn: string | null
  cargadaPor: string | null
  valor: number | null
  // F-PRE-06: «Aviso en Inicio» de la configuración; apagado, ningún aviso de «dólar sin cargar» se muestra.
  avisoActivo: boolean
}

type DelDiaRpc = {
  cargada_hoy: boolean
  cargada_en: string | null
  cargada_por: string | null
  valor: number | string | null
  aviso_activo?: boolean
}

type EstadoRpc = {
  vigente: { valor: number | string; cargada_en: string; cargada_por: string | null } | null
  aplicada?: number | string | null
  productos_usd: number | string
  pendiente: { valor: number | string; expira_en: string } | null
  alcance?: AlcanceCotizacion
  umbral_pct?: number | string
  confirmacion_pct?: number | string
  redondeo_pesos?: number | string
}

type CargaRpc = { valor: number | string; anterior: number | string | null; variacion_pct: number | string | null; expira_en: string }

const MAXIMO_EXCLUSIVO = 10_000_000_000
// `1490`, `1490,50`, `1.490` o `1.490,5`: el punto agrupa miles (exactamente de a 3 dígitos) y la coma
// marca los decimales (hasta 4, como la base). `1490.50` NO se interpreta: sería ambiguo.
const FORMATO_VALOR = /^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,4})?$/

// Texto del campo → número, o null si no es un valor válido (vacío, cero, negativo, no numérico).
export function parsearCotizacion(texto: string): number | null {
  const limpio = texto.trim()
  if (!FORMATO_VALOR.test(limpio)) return null
  const valor = Number(limpio.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(valor) && valor > 0 && valor < MAXIMO_EXCLUSIVO ? valor : null
}

// El campo solo admite dígitos, punto y coma (como el prototipo).
export const soloCaracteresDeCotizacion = (texto: string) => texto.replace(/[^0-9.,]/g, '')

// Campo del dólar de los diálogos: igual, pero conserva el «-»: un negativo NO se corrige en silencio a un valor
// positivo (CA-INI-07-8), `parsearCotizacion` lo rechaza y el campo muestra el mensaje de formato inválido.
export const caracteresDelCampoDolar = (texto: string) => texto.replace(/[^0-9.,-]/g, '')

// Variación porcentual del valor nuevo contra el anterior; null si no hay anterior.
export function variacionPorcentual(nuevo: number, anterior: number | null): number | null {
  if (anterior === null || anterior <= 0) return null
  return (nuevo / anterior - 1) * 100
}

const formatoVariacion = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

// «+1,7 %» / «−0,3 %» (signo menos tipográfico, como el prototipo); sin dato → «—».
export function formatearVariacion(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return '—'
  const redondeada = Math.round(Math.abs(pct) * 10) / 10
  const signo = pct < 0 && redondeada !== 0 ? '−' : '+'
  return `${signo}${formatoVariacion.format(redondeada)} %`
}

export const esVariacionInusual = (pct: number | null, umbralPct: number = UMBRAL_VARIACION_INUSUAL_PCT) => pct !== null && Math.abs(pct) > umbralPct

export const formatearCotizacion = (valor: number) => formatearPesosPrecio(valor)

// «Última carga: vie 25/09 por Javier»; sin quién (cotización inicial) → «Última carga: vie 25/09».
export function subtituloVigente(vigente: CotizacionVigente): string {
  const fecha = formatearFechaCotizacion(vigente.cargadaEn)
  const base = fecha ? `Última carga: ${fecha}` : 'Última carga'
  return vigente.cargadaPor ? `${base} por ${vigente.cargadaPor}` : base
}

const formatoHora = new Intl.DateTimeFormat('es-AR', {
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Argentina/Buenos_Aires',
})

// «Cargada hoy 10:32 por Administrador» (FR-022); sin hora válida o sin quién se omiten.
export function subtituloCargadaHoy(delDia: CotizacionDelDia): string {
  const fecha = delDia.cargadaEn ? new Date(delDia.cargadaEn) : null
  const hora = fecha && !Number.isNaN(fecha.getTime()) ? formatoHora.format(fecha) : ''
  const base = hora ? `Cargada hoy ${hora}` : 'Cargada hoy'
  return delDia.cargadaPor ? `${base} por ${delDia.cargadaPor}` : base
}

// «Anterior: $ 1.465 (vie 25/09)» del diálogo.
// Con una cotización APLICADA distinta de la última carga (quedó bajo el umbral) se muestra la aplicada: es la que usan los precios
// y contra la que la base mide la variación.
export function textoAnterior(vigente: CotizacionVigente, aplicada?: number | null): string {
  if (aplicada !== undefined && aplicada !== null && aplicada !== vigente.valor) {
    return `Anterior: ${formatearCotizacion(aplicada)} (la que usan los precios)`
  }
  const fecha = formatearFechaCotizacion(vigente.cargadaEn)
  return `Anterior: ${formatearCotizacion(vigente.valor)}${fecha ? ` (${fecha})` : ''}`
}

// Mensaje claro para el usuario según el código de la base; nunca el texto técnico.
export function mensajeDeErrorCotizacion(error: { code?: string } | null | undefined): string {
  switch (error?.code) {
    case '42501': return 'Tu rol no puede cargar la cotización del dólar.'
    case '23514':
    case '22003': return MENSAJE_VALOR_INVALIDO
    default: return 'No pudimos cargar la cotización. Intentá de nuevo.'
  }
}

// Con alcance «una por empresa» la base pide la empresa (`p_empresa`); sin ella la llamada es la de siempre.
const conEmpresa = (empresaId: string | null | undefined) => (empresaId ? { p_empresa: empresaId } : {})

async function llamar(cliente: SupabaseClient, funcion: string, parametros: Record<string, unknown>) {
  return Object.keys(parametros).length === 0 ? cliente.rpc(funcion) : cliente.rpc(funcion, parametros)
}

export async function leerEstadoCotizacion(cliente: SupabaseClient, empresaId?: string | null): Promise<EstadoCotizacion> {
  const { data, error } = await llamar(cliente, 'estado_cotizacion', conEmpresa(empresaId))
  if (error) throw error
  const estado = data as EstadoRpc
  return {
    alcance: estado.alcance ?? 'sistema',
    umbralPct: estado.umbral_pct === undefined ? UMBRAL_RECALCULO_PCT : Number(estado.umbral_pct),
    confirmacionPct: estado.confirmacion_pct === undefined ? UMBRAL_VARIACION_INUSUAL_PCT : Number(estado.confirmacion_pct),
    redondeoPesos: estado.redondeo_pesos === undefined ? REDONDEO_POR_DEFECTO : Number(estado.redondeo_pesos),
    vigente: estado.vigente
      ? { valor: Number(estado.vigente.valor), cargadaEn: estado.vigente.cargada_en, cargadaPor: estado.vigente.cargada_por }
      : null,
    aplicada: estado.aplicada === undefined || estado.aplicada === null ? null : Number(estado.aplicada),
    productosUsd: Number(estado.productos_usd),
    pendiente: estado.pendiente ? { valor: Number(estado.pendiente.valor), expiraEn: estado.pendiente.expira_en } : null,
  }
}

export async function cargarCotizacionRpc(cliente: SupabaseClient, valor: number, empresaId?: string | null): Promise<CotizacionCargada> {
  const { data, error } = await cliente.rpc('cargar_cotizacion', { p_valor: valor, ...conEmpresa(empresaId) })
  if (error) throw error
  const carga = data as CargaRpc
  return {
    valor: Number(carga.valor),
    anterior: carga.anterior === null ? null : Number(carga.anterior),
    variacionPct: carga.variacion_pct === null ? null : Number(carga.variacion_pct),
    expiraEn: carga.expira_en,
  }
}

export async function leerCotizacionDelDia(cliente: SupabaseClient, empresaId?: string | null): Promise<CotizacionDelDia> {
  const { data, error } = await llamar(cliente, 'cotizacion_del_dia', conEmpresa(empresaId))
  if (error) throw error
  const dia = data as DelDiaRpc
  return {
    avisoActivo: dia.aviso_activo ?? true,
    cargadaHoy: dia.cargada_hoy,
    cargadaEn: dia.cargada_en,
    cargadaPor: dia.cargada_por,
    valor: dia.valor === null ? null : Number(dia.valor),
  }
}

// ---------------------------------------------------------------------------
// F-PRE-03: vista previa de impacto, confirmación y descarte
// ---------------------------------------------------------------------------

// Umbral y redondeo del lanzamiento (F-PRE-06 los configura): la decisión la toma siempre la base.
export const UMBRAL_RECALCULO_PCT = 1
export const REDONDEO_POR_DEFECTO = 10

export const MENSAJE_DOLAR_CAMBIO = 'El dólar cambió mientras revisabas: revisá de nuevo.'
export const MENSAJE_VARIACION_SIN_CONFIRMAR = 'La variación supera lo configurado y hay que confirmarla de forma explícita. Revisá el valor y volvé a intentar.'
export const MENSAJE_COTIZACION_VENCIDA = 'La cotización cargada venció; volvé a cargarla.'
export const AVISO_COTIZACION_REGISTRADA = 'Cotización registrada · variación menor al umbral, precios sin cambios'
export const avisoCotizacionAplicada = (precios: number) => `Cotización aplicada · ${precios} precios recalculados`

export type PrecioPorEmpresa = { empresaId: string; hoy: number | null; nuevo: number | null; usd?: number | null }

// `usd` es null cuando el producto está en pesos y solo tiene precio propio en dólares en alguna empresa: ahí se toma el de la primera.
export type MuestraPrecio = { producto: string; sku: string | null; usd: number | null; porEmpresa: PrecioPorEmpresa[] }

type MuestraRpc = {
  producto: string
  sku: string | null
  usd: number | string | null
  por_empresa: { empresa_id: string; hoy: number | string | null; nuevo: number | string | null; usd?: number | string | null }[]
}

export type Previsualizacion = {
  variacionPct: number | null
  recalcula: boolean
  // F-PRE-06: lo configurado con lo que decidió la base.
  umbralPct: number
  // La variación inusual configurada AHORA en la base: manda sobre la que pudo quedar vieja en la pantalla.
  confirmacionPct?: number
  redondeoPesos: number
  empresas: { empresaId: string; nombre: string; precios: number }[]
  muestra: MuestraPrecio[]
}

export type CotizacionConfirmada = { id: string; recalculoAplicado: boolean; preciosRecalculados: number }

type PrevisualizacionRpc = {
  variacion_pct: number | string | null
  recalcula: boolean
  umbral_pct?: number | string
  confirmacion_pct?: number | string
  redondeo_pesos?: number | string
  empresas: { empresa_id: string; nombre: string; precios: number | string }[]
  muestra: MuestraRpc[]
}

type ConfirmadaRpc = { id: string; recalculo_aplicado: boolean; precios_recalculados: number | string }

const aNumeroONulo = (valor: number | string | null | undefined) => (valor === null || valor === undefined ? null : Number(valor))

function aMuestraPrecio(m: MuestraRpc): MuestraPrecio {
  const porEmpresa = m.por_empresa.map((p) => ({
    empresaId: p.empresa_id, hoy: aNumeroONulo(p.hoy), nuevo: aNumeroONulo(p.nuevo), usd: aNumeroONulo(p.usd),
  }))
  return { producto: m.producto, sku: m.sku, usd: aNumeroONulo(m.usd) ?? porEmpresa.find((p) => p.usd !== null)?.usd ?? null, porEmpresa }
}

// «$ 10.500»; sin precio (producto en USD sin cotización) → «—», nunca un valor inventado.
export const formatearPrecioPrevio = (valor: number | null) => (valor === null ? '—' : formatearCotizacion(valor))

// «38 precios» / «1 precio» del mosaico por empresa.
export const textoPrecios = (cantidad: number) => `${cantidad} ${cantidad === 1 ? 'precio' : 'precios'}`

// ¿Hay que volver a calcular la vista previa? Sí cuando la base rechazó porque la variación real ya no es la que se vio.
export const requiereRevisarDeNuevo = (error: { code?: string; hint?: string | null } | null | undefined) =>
  error?.code === '22023' && (error.hint === 'variacion_cambio' || error.hint === 'variacion_inusual')

// Mensaje claro para el usuario al confirmar o descartar; nunca el texto técnico de la base.
export function mensajeDeErrorConfirmacion(error: { code?: string; hint?: string | null } | null | undefined): string {
  switch (error?.code) {
    case 'P0002': return MENSAJE_COTIZACION_VENCIDA
    case '42501': return 'Tu rol no puede confirmar la cotización del dólar.'
    // 22023 también es «falta empresa»: solo la variación inusual lleva este hint.
    case '22023':
      if (error.hint === 'variacion_cambio') return MENSAJE_DOLAR_CAMBIO
      return error.hint === 'variacion_inusual' ? MENSAJE_VARIACION_SIN_CONFIRMAR : 'No pudimos confirmar la cotización. Intentá de nuevo.'
    default: return 'No pudimos confirmar la cotización. Intentá de nuevo.'
  }
}

function aPrevisualizacion(previa: PrevisualizacionRpc): Previsualizacion {
  return {
    variacionPct: aNumeroONulo(previa.variacion_pct),
    recalcula: previa.recalcula,
    umbralPct: previa.umbral_pct === undefined ? UMBRAL_RECALCULO_PCT : Number(previa.umbral_pct),
    confirmacionPct: previa.confirmacion_pct === undefined ? undefined : Number(previa.confirmacion_pct),
    redondeoPesos: previa.redondeo_pesos === undefined ? REDONDEO_POR_DEFECTO : Number(previa.redondeo_pesos),
    empresas: previa.empresas.map((e) => ({ empresaId: e.empresa_id, nombre: e.nombre, precios: Number(e.precios) })),
    muestra: previa.muestra.map(aMuestraPrecio),
  }
}

export async function previsualizarCotizacionRpc(cliente: SupabaseClient, empresaId?: string | null): Promise<Previsualizacion> {
  const { data, error } = await llamar(cliente, 'previsualizar_cotizacion', conEmpresa(empresaId))
  if (error) throw error
  return aPrevisualizacion(data as PrevisualizacionRpc)
}

// F-INI-07: vista previa de SOLO LECTURA de un valor de dólar (`previsualizar_impacto_dolar`): no exige ni escribe
// la cotización pendiente, así que cancelar no deja nada guardado. Misma forma que la vista previa de la pendiente.
export async function previsualizarImpactoDolarRpc(cliente: SupabaseClient, valor: number, empresaId?: string | null): Promise<Previsualizacion> {
  const { data, error } = await llamar(cliente, 'previsualizar_impacto_dolar', { p_valor: valor, ...conEmpresa(empresaId) })
  if (error) throw error
  return aPrevisualizacion(data as PrevisualizacionRpc)
}

// `variacionVista`: la variación (%) del aviso de variación inusual que el usuario tenía a la vista al apretar «Aplicar»; la base
// exige que coincida con la real (±0,01) y rechaza si el dólar cambió mientras revisaba. Sin aviso a la vista va null.
export async function confirmarCotizacionRpc(
  cliente: SupabaseClient,
  empresaId?: string | null,
  variacionVista: number | null = null,
): Promise<CotizacionConfirmada> {
  const { data, error } = await llamar(cliente, 'confirmar_cotizacion', {
    ...conEmpresa(empresaId),
    ...(variacionVista !== null ? { p_variacion_vista: variacionVista } : {}),
  })
  if (error) throw error
  const confirmada = data as ConfirmadaRpc
  return {
    id: confirmada.id,
    recalculoAplicado: confirmada.recalculo_aplicado,
    preciosRecalculados: Number(confirmada.precios_recalculados),
  }
}

// Carga Y confirma el dólar en una sola transacción (`aplicar_cotizacion`, F-INI-07): no deja pendiente huérfana
// si la confirmación falla. Mismos parámetros y errores que `cargar_cotizacion` + `confirmar_cotizacion`.
export async function aplicarCotizacionRpc(
  cliente: SupabaseClient,
  valor: number,
  empresaId?: string | null,
  variacionVista: number | null = null,
): Promise<CotizacionConfirmada> {
  const { data, error } = await llamar(cliente, 'aplicar_cotizacion', {
    p_valor: valor,
    ...conEmpresa(empresaId),
    ...(variacionVista !== null ? { p_variacion_vista: variacionVista } : {}),
  })
  if (error) throw error
  const confirmada = data as ConfirmadaRpc
  return {
    id: confirmada.id,
    recalculoAplicado: confirmada.recalculo_aplicado,
    preciosRecalculados: Number(confirmada.precios_recalculados),
  }
}

// Mensaje claro al aplicar: los errores de carga (permiso, valor) y los de confirmación (variación, vencida).
export function mensajeDeErrorAplicacion(error: { code?: string; hint?: string | null } | null | undefined): string {
  if (error?.code === '23514' || error?.code === '22003') return MENSAJE_VALOR_INVALIDO
  if (error?.code === '42501') return 'Tu rol no puede cargar la cotización del dólar.'
  return mensajeDeErrorConfirmacion(error)
}

export async function descartarCotizacionRpc(cliente: SupabaseClient, empresaId?: string | null): Promise<void> {
  const { error } = await llamar(cliente, 'descartar_cotizacion', conEmpresa(empresaId))
  if (error) throw error
}

// ---------------------------------------------------------------------------
// F-PRE-06: configuración de la cotización (alcance, redondeo, umbral, confirmación y aviso)
// ---------------------------------------------------------------------------

export type ConfiguracionCotizacion = {
  alcance: AlcanceCotizacion
  redondeoPesos: number
  umbralPct: number
  confirmacionPct: number
  avisoActivo: boolean
}

// Lo que rige sin configuración guardada (los valores del lanzamiento).
export const CONFIGURACION_POR_DEFECTO: ConfiguracionCotizacion = {
  alcance: 'sistema',
  redondeoPesos: REDONDEO_POR_DEFECTO,
  umbralPct: UMBRAL_RECALCULO_PCT,
  confirmacionPct: UMBRAL_VARIACION_INUSUAL_PCT,
  avisoActivo: true,
}

// Opciones de «Redondeo del precio en pesos» (las de la regla de la empresa, F-PRE-07).
export const OPCIONES_REDONDEO: ReadonlyArray<{ valor: number; etiqueta: string }> = [
  { valor: 1, etiqueta: 'Sin redondeo' },
  { valor: 10, etiqueta: 'Al $ 10 más cercano' },
  { valor: 50, etiqueta: 'Al $ 50 más cercano' },
  { valor: 100, etiqueta: 'Al $ 100 más cercano' },
]

export const MENSAJE_UMBRAL_INVALIDO = 'Ingresá un umbral entre 0 y 100, por ejemplo 1 o 0,5.'
export const MENSAJE_CONFIGURACION_GUARDADA = 'Configuración guardada'
export const TEXTO_QUIEN_CARGA = 'Solo pueden cargarla los roles con edición en «Cotización del dólar» (hoy: Administrador).'

// «Redondeo al $ 10 más cercano.» / «Sin redondeo.» (pie de la vista previa y de la tabla de muestra).
export const notaRedondeo = (redondeoPesos: number) =>
  redondeoPesos <= 1 ? 'Sin redondeo.' : `Redondeo al $ ${redondeoPesos} más cercano.`

const formatoPorcentaje = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 3 })

// «1», «0,5», «15»: un porcentaje sin ceros de más, con coma decimal.
export const formatearPorcentaje = (pct: number) => formatoPorcentaje.format(pct)

// «Sin cambios (< 2 %)» de una carga del historial que no alcanzó el umbral con el que se decidió.
export const textoSinCambios = (umbralPct: number) => `Sin cambios (< ${formatearPorcentaje(umbralPct)} %)`

// «La variación es menor al umbral de 2 %: …»
export const textoUmbralNoAlcanzado = (umbralPct: number) =>
  `La variación es menor al umbral de ${formatearPorcentaje(umbralPct)} %: la cotización queda registrada, pero no se recalculan precios.`

// «San Javucho y Mundo JC cargan su propio valor. Cada oferta en USD usa el de su empresa.» con los nombres reales.
export function textoAlcancePorEmpresa(nombres: ReadonlyArray<string>): string {
  const lista = nombres.length <= 1
    ? (nombres[0] ?? 'Cada empresa')
    : `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`
  return `${lista} ${nombres.length <= 1 ? 'carga' : 'cargan'} su propio valor. Cada oferta en USD usa el de su empresa.`
}

// Texto del campo del umbral → número entre 0 y 100 (coma o punto decimal, hasta 3 decimales), o null.
export function parsearUmbral(texto: string): number | null {
  const limpio = texto.trim()
  if (!/^\d{1,3}(?:[.,]\d{1,3})?$/.test(limpio)) return null
  const valor = Number(limpio.replace(',', '.'))
  return Number.isFinite(valor) && valor >= 0 && valor <= 100 ? valor : null
}

// Mensaje claro al guardar la configuración; nunca el texto técnico de la base.
export function mensajeDeErrorConfiguracion(error: { code?: string } | null | undefined): string {
  switch (error?.code) {
    case '42501': return 'Tu rol no puede cambiar la configuración de la cotización.'
    case '22023': return 'Revisá los valores: el umbral va de 0 a 100 y la confirmación debe ser mayor al umbral.'
    default: return 'No pudimos guardar la configuración. Intentá de nuevo.'
  }
}

export function mensajeDeErrorAlcance(error: { code?: string } | null | undefined): string {
  switch (error?.code) {
    case '42501': return 'Tu rol no puede cambiar el alcance de la cotización.'
    default: return 'No pudimos cambiar el alcance de la cotización. Intentá de nuevo.'
  }
}

type ConfiguracionRpc = {
  alcance: AlcanceCotizacion
  redondeo_pesos: number | string
  umbral_pct: number | string
  confirmacion_pct: number | string
  aviso_activo: boolean
}

export async function leerConfiguracionCotizacion(cliente: SupabaseClient): Promise<ConfiguracionCotizacion> {
  const { data, error } = await cliente.rpc('obtener_configuracion_cotizacion')
  if (error) throw error
  const configuracion = data as ConfiguracionRpc
  return {
    alcance: configuracion.alcance,
    redondeoPesos: Number(configuracion.redondeo_pesos),
    umbralPct: Number(configuracion.umbral_pct),
    confirmacionPct: Number(configuracion.confirmacion_pct),
    avisoActivo: configuracion.aviso_activo,
  }
}

// El alcance no se guarda acá: cambia con `cambiarAlcanceCotizacion`, después de ver la vista previa.
export async function guardarConfiguracionCotizacion(
  cliente: SupabaseClient,
  valores: Omit<ConfiguracionCotizacion, 'alcance'>,
): Promise<{ actualizado: boolean }> {
  const { data, error } = await cliente.rpc('guardar_configuracion_cotizacion', {
    p_redondeo: valores.redondeoPesos,
    p_umbral: valores.umbralPct,
    p_confirmacion: valores.confirmacionPct,
    p_aviso: valores.avisoActivo,
  })
  if (error) throw error
  return { actualizado: (data as { actualizado: boolean }).actualizado }
}

export type PrevisualizacionAlcance = {
  alcanceActual: AlcanceCotizacion
  redondeoPesos: number
  empresas: { empresaId: string; nombre: string; preciosQueCambian: number }[]
  muestra: MuestraPrecio[]
}

type PrevisualizacionAlcanceRpc = {
  alcance_actual: AlcanceCotizacion
  redondeo_pesos?: number | string
  empresas: { empresa_id: string; nombre: string; precios_que_cambian: number | string }[]
  muestra: MuestraRpc[]
}

export async function previsualizarCambioAlcanceRpc(cliente: SupabaseClient, alcance: AlcanceCotizacion): Promise<PrevisualizacionAlcance> {
  const { data, error } = await cliente.rpc('previsualizar_cambio_alcance', { p_alcance: alcance })
  if (error) throw error
  const previa = data as PrevisualizacionAlcanceRpc
  return {
    alcanceActual: previa.alcance_actual,
    redondeoPesos: previa.redondeo_pesos === undefined ? REDONDEO_POR_DEFECTO : Number(previa.redondeo_pesos),
    empresas: previa.empresas.map((e) => ({ empresaId: e.empresa_id, nombre: e.nombre, preciosQueCambian: Number(e.precios_que_cambian) })),
    muestra: previa.muestra.map(aMuestraPrecio),
  }
}

export async function cambiarAlcanceCotizacionRpc(
  cliente: SupabaseClient,
  alcance: AlcanceCotizacion,
): Promise<{ alcance: AlcanceCotizacion; preciosAfectados: number }> {
  // Se llama después de la vista previa: la confirmación es explícita, la base la exige igual.
  const { data, error } = await cliente.rpc('cambiar_alcance_cotizacion', { p_alcance: alcance, p_confirmado: true })
  if (error) throw error
  const cambio = data as { alcance: AlcanceCotizacion; precios_afectados: number | string }
  return { alcance: cambio.alcance, preciosAfectados: Number(cambio.precios_afectados) }
}

// F-PRE-13 (MSF-373): dólar del día SUGERIDO por una fuente pública. La Edge Function `cotizacion-sugerida` lo
// consulta en el servidor (la URL de la fuente no sale del navegador) y exige sesión y edición del dólar. Es solo una
// ayuda: nunca guarda ni cambia precios; la carga y la confirmación siguen siendo las de F-PRE-02/03.
export type CotizacionSugerida = { valor: number; fuente: string; fecha: string | null }

export const esCotizacionSugerida = (dato: unknown): dato is CotizacionSugerida => {
  if (typeof dato !== 'object' || dato === null) return false
  const { valor, fuente, fecha } = dato as Record<string, unknown>
  return typeof valor === 'number' && Number.isFinite(valor) && valor > 0 && valor < MAXIMO_EXCLUSIVO
    && typeof fuente === 'string' && (fecha === null || typeof fecha === 'string')
}

// Valor sugerido → texto del campo (coma decimal, sin separador de miles: lo que acepta `parsearCotizacion`).
export const textoDeCotizacionSugerida = (valor: number) => String(valor).replace('.', ',')
