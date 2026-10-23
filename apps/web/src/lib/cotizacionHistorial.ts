import type { SupabaseClient } from '@supabase/supabase-js'
import { UMBRAL_RECALCULO_PCT, textoPrecios } from './cotizacion'

// Historial de cargas de la cotización del dólar (F-PRE-04, MSF-286; FR-017/FR-018). La autoridad es la
// base (migración 20261023120000: `listar_cotizaciones`, tabla `dominio.cotizaciones` inmutable); acá
// solo se traduce la respuesta y se arma el texto de cada celda.

export const TAMANO_PAGINA_HISTORIAL_COTIZACIONES = 10

export const PIE_TRAZABILIDAD_COTIZACION =
  'Cada cambio de precio guarda la cotización usada, para reconstruir la rentabilidad de cualquier fecha.'

export type CargaCotizacion = {
  id: string
  cargadaEn: string
  valor: number
  // Contra la carga anterior; null en la primera de la organización.
  variacionPct: number | null
  // null si quien cargó ya no existe (FK on delete set null).
  cargadaPorNombre: string | null
  recalculoAplicado: boolean
  preciosRecalculados: number
}

export type PaginaHistorialCotizaciones = {
  filas: CargaCotizacion[]
  siguienteCursor: string | null
}

type CargaRpc = {
  id: string
  cargada_en: string
  valor: number | string
  variacion_pct: number | string | null
  cargada_por_nombre: string | null
  recalculo_aplicado: boolean
  precios_recalculados: number | string
}

type PaginaRpc = { filas: CargaRpc[]; siguiente_cursor: string | null }

export async function listarCotizacionesRpc(
  cliente: SupabaseClient,
  cursor: string | null,
  limite: number = TAMANO_PAGINA_HISTORIAL_COTIZACIONES,
): Promise<PaginaHistorialCotizaciones> {
  const { data, error } = await cliente.rpc('listar_cotizaciones', { p_limite: limite, p_cursor: cursor })
  if (error) throw error
  const pagina = data as PaginaRpc
  return {
    filas: pagina.filas.map((fila) => ({
      id: fila.id,
      cargadaEn: fila.cargada_en,
      valor: Number(fila.valor),
      variacionPct: fila.variacion_pct === null ? null : Number(fila.variacion_pct),
      cargadaPorNombre: fila.cargada_por_nombre,
      recalculoAplicado: fila.recalculo_aplicado,
      preciosRecalculados: Number(fila.precios_recalculados),
    })),
    siguienteCursor: pagina.siguiente_cursor,
  }
}

// Columna «Precios»: «38 precios» si recalculó; si no, «Sin cambios (< 1 %)» (el umbral es el de la base).
export const textoPreciosCarga = (carga: Pick<CargaCotizacion, 'recalculoAplicado' | 'preciosRecalculados'>) =>
  carga.recalculoAplicado ? textoPrecios(carga.preciosRecalculados) : `Sin cambios (< ${UMBRAL_RECALCULO_PCT} %)`

export type TonoVariacion = 'sube' | 'baja' | 'igual'

// Como el prototipo: sube = aviso (el dólar más caro encarece los precios), baja = ok, sin dato o igual = neutro.
export function tonoVariacion(pct: number | null): TonoVariacion {
  if (pct === null || !Number.isFinite(pct)) return 'igual'
  const redondeada = Math.round(pct * 10) / 10
  if (redondeada > 0) return 'sube'
  if (redondeada < 0) return 'baja'
  return 'igual'
}

const formatoFechaHora = new Intl.DateTimeFormat('es-AR', {
  weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  timeZone: 'America/Argentina/Buenos_Aires',
})

// «vie 25/09 · 09:12» (hora de Buenos Aires); fecha inválida → «—».
export function formatearFechaHoraCarga(iso: string): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return '—'
  const partes = formatoFechaHora.formatToParts(fecha)
  const buscar = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? ''
  return `${buscar('weekday').replace('.', '')} ${buscar('day')}/${buscar('month')} · ${buscar('hour')}:${buscar('minute')}`
}
