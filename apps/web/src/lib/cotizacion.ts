import type { SupabaseClient } from '@supabase/supabase-js'
import { formatearFechaCotizacion, formatearPesosPrecio } from './precios'

// Carga diaria de la cotización del dólar (F-PRE-02, MSF-246) y su confirmación (F-PRE-03, MSF-267).
// La autoridad es la base (migraciones 20261023140000, 20261023140100, 20261023140200 y 20261023140300:
// `cargar_cotizacion`, `estado_cotizacion`, `previsualizar_cotizacion`, `confirmar_cotizacion`,
// `descartar_cotizacion`); acá se espeja SOLO el parseo y la variación para dar feedback mientras se escribe.

// Alerta «Variación inusual» (FR-007): solo avisa, no bloquea.
export const UMBRAL_VARIACION_INUSUAL_PCT = 15

export const MENSAJE_VALOR_INVALIDO = 'Ingresá un valor válido, por ejemplo 1490 o 1490,50.'

export type CotizacionVigente = {
  valor: number
  cargadaEn: string
  // null cuando la vigente es la cotización inicial (nadie la «cargó» en esta pantalla).
  cargadaPor: string | null
}

export type EstadoCotizacion = {
  vigente: CotizacionVigente | null
  productosUsd: number
  pendiente: { valor: number; expiraEn: string } | null
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
}

type DelDiaRpc = { cargada_hoy: boolean; cargada_en: string | null; cargada_por: string | null; valor: number | string | null }

type EstadoRpc = {
  vigente: { valor: number | string; cargada_en: string; cargada_por: string | null } | null
  productos_usd: number | string
  pendiente: { valor: number | string; expira_en: string } | null
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

export const esVariacionInusual = (pct: number | null) => pct !== null && Math.abs(pct) > UMBRAL_VARIACION_INUSUAL_PCT

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
export function textoAnterior(vigente: CotizacionVigente): string {
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

export async function leerEstadoCotizacion(cliente: SupabaseClient): Promise<EstadoCotizacion> {
  const { data, error } = await cliente.rpc('estado_cotizacion')
  if (error) throw error
  const estado = data as EstadoRpc
  return {
    vigente: estado.vigente
      ? { valor: Number(estado.vigente.valor), cargadaEn: estado.vigente.cargada_en, cargadaPor: estado.vigente.cargada_por }
      : null,
    productosUsd: Number(estado.productos_usd),
    pendiente: estado.pendiente ? { valor: Number(estado.pendiente.valor), expiraEn: estado.pendiente.expira_en } : null,
  }
}

export async function cargarCotizacionRpc(cliente: SupabaseClient, valor: number): Promise<CotizacionCargada> {
  const { data, error } = await cliente.rpc('cargar_cotizacion', { p_valor: valor })
  if (error) throw error
  const carga = data as CargaRpc
  return {
    valor: Number(carga.valor),
    anterior: carga.anterior === null ? null : Number(carga.anterior),
    variacionPct: carga.variacion_pct === null ? null : Number(carga.variacion_pct),
    expiraEn: carga.expira_en,
  }
}

export async function leerCotizacionDelDia(cliente: SupabaseClient): Promise<CotizacionDelDia> {
  const { data, error } = await cliente.rpc('cotizacion_del_dia')
  if (error) throw error
  const dia = data as DelDiaRpc
  return {
    cargadaHoy: dia.cargada_hoy,
    cargadaEn: dia.cargada_en,
    cargadaPor: dia.cargada_por,
    valor: dia.valor === null ? null : Number(dia.valor),
  }
}

// ---------------------------------------------------------------------------
// F-PRE-03: vista previa de impacto, confirmación y descarte
// ---------------------------------------------------------------------------

// Umbral fijo del lanzamiento (la configuración es F-PRE-06, Etapa 2): la decisión la toma la base.
export const UMBRAL_RECALCULO_PCT = 1

export const NOTA_REDONDEO = 'Redondeo al $ 10 más cercano.'
export const MENSAJE_COTIZACION_VENCIDA = 'La cotización cargada venció; volvé a cargarla.'
export const AVISO_COTIZACION_REGISTRADA = 'Cotización registrada · variación menor al umbral, precios sin cambios'
export const avisoCotizacionAplicada = (precios: number) => `Cotización aplicada · ${precios} precios recalculados`

export type PrecioPorEmpresa = { empresaId: string; hoy: number | null; nuevo: number | null }

export type Previsualizacion = {
  variacionPct: number | null
  recalcula: boolean
  empresas: { empresaId: string; nombre: string; precios: number }[]
  muestra: { producto: string; sku: string | null; usd: number; porEmpresa: PrecioPorEmpresa[] }[]
}

export type CotizacionConfirmada = { id: string; recalculoAplicado: boolean; preciosRecalculados: number }

type PrevisualizacionRpc = {
  variacion_pct: number | string | null
  recalcula: boolean
  empresas: { empresa_id: string; nombre: string; precios: number | string }[]
  muestra: {
    producto: string
    sku: string | null
    usd: number | string
    por_empresa: { empresa_id: string; hoy: number | string | null; nuevo: number | string | null }[]
  }[]
}

type ConfirmadaRpc = { id: string; recalculo_aplicado: boolean; precios_recalculados: number | string }

const aNumeroONulo = (valor: number | string | null) => (valor === null ? null : Number(valor))

// «$ 10.500»; sin precio (producto en USD sin cotización) → «—», nunca un valor inventado.
export const formatearPrecioPrevio = (valor: number | null) => (valor === null ? '—' : formatearCotizacion(valor))

// «38 precios» / «1 precio» del mosaico por empresa.
export const textoPrecios = (cantidad: number) => `${cantidad} ${cantidad === 1 ? 'precio' : 'precios'}`

// Mensaje claro para el usuario al confirmar o descartar; nunca el texto técnico de la base.
export function mensajeDeErrorConfirmacion(error: { code?: string } | null | undefined): string {
  switch (error?.code) {
    case 'P0002': return MENSAJE_COTIZACION_VENCIDA
    case '42501': return 'Tu rol no puede confirmar la cotización del dólar.'
    default: return 'No pudimos confirmar la cotización. Intentá de nuevo.'
  }
}

export async function previsualizarCotizacionRpc(cliente: SupabaseClient): Promise<Previsualizacion> {
  const { data, error } = await cliente.rpc('previsualizar_cotizacion')
  if (error) throw error
  const previa = data as PrevisualizacionRpc
  return {
    variacionPct: aNumeroONulo(previa.variacion_pct),
    recalcula: previa.recalcula,
    empresas: previa.empresas.map((e) => ({ empresaId: e.empresa_id, nombre: e.nombre, precios: Number(e.precios) })),
    muestra: previa.muestra.map((m) => ({
      producto: m.producto,
      sku: m.sku,
      usd: Number(m.usd),
      porEmpresa: m.por_empresa.map((p) => ({ empresaId: p.empresa_id, hoy: aNumeroONulo(p.hoy), nuevo: aNumeroONulo(p.nuevo) })),
    })),
  }
}

export async function confirmarCotizacionRpc(cliente: SupabaseClient): Promise<CotizacionConfirmada> {
  const { data, error } = await cliente.rpc('confirmar_cotizacion')
  if (error) throw error
  const confirmada = data as ConfirmadaRpc
  return {
    id: confirmada.id,
    recalculoAplicado: confirmada.recalculo_aplicado,
    preciosRecalculados: Number(confirmada.precios_recalculados),
  }
}

export async function descartarCotizacionRpc(cliente: SupabaseClient): Promise<void> {
  const { error } = await cliente.rpc('descartar_cotizacion')
  if (error) throw error
}
