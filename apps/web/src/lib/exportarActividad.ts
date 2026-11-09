import type { SupabaseClient } from '@supabase/supabase-js'
import { etiquetaTipoActividad, formatearCuando, rangoDelPeriodo, tiendaDelEvento, type FiltrosActividad } from './actividad'
import { armarCsv, descargarCsv, nombreArchivoCsv, type ColumnaCsv } from './exportarCsv'

// Exportación de la actividad a CSV (F-AUD-03, MSF-278, FR-011…FR-013). Las filas salen de la RPC
// `exportar_actividad` (mismos filtros que `listar_actividad`), en lotes y con un instante de corte
// estable; acá se arma el CSV con las columnas de la tabla y se descarga. Si algo falla, falta
// alguna fila o el filtro supera el tope, no se descarga nada: nunca un archivo parcial.

/** Tope por archivo (RF-AUD-03-3). Lo aplica también la base; acá decide si se descarga o se pide acotar. */
export const TOPE_FILAS_ACTIVIDAD = 50_000
export const LOTE_EXPORTACION_ACTIVIDAD = 1000

export type FilaExportacionActividad = {
  creado_en: string
  tipo: string
  empresa_id: string | null
  empresa_nombre: string | null
  actor_nombre: string | null
  detalle: string
}

type RespuestaExportacion = {
  filas: FilaExportacionActividad[]
  /** Solo viene cuando se pide (primera llamada). */
  total: number | null
  tope: number
  corte: string
  hay_mas: boolean
  siguiente: { creado_en: string; id: string } | null
}

// Las mismas columnas y textos que la tabla de Actividad, en el mismo orden (FR-012).
export const COLUMNAS_EXPORTACION_ACTIVIDAD: readonly ColumnaCsv<FilaExportacionActividad>[] = [
  { encabezado: 'Cuándo', valor: (fila) => formatearCuando(fila.creado_en) },
  { encabezado: 'Tipo', valor: (fila) => etiquetaTipoActividad(fila.tipo) },
  { encabezado: 'Tienda', valor: (fila) => tiendaDelEvento(fila.empresa_nombre, fila.empresa_id) },
  { encabezado: 'Detalle', valor: (fila) => fila.detalle },
  { encabezado: 'Quién', valor: (fila) => fila.actor_nombre ?? 'Sistema' },
]

export function armarCsvActividad(filas: readonly FilaExportacionActividad[]): string {
  return armarCsv(COLUMNAS_EXPORTACION_ACTIVIDAD, filas)
}

/** `actividad-AAAA-MM-DD.csv`, con la fecha de hoy en la zona de la organización. */
export const nombreArchivoActividad = (ahora?: Date) => nombreArchivoCsv('actividad', ahora)

export type ResultadoExportacionActividad =
  | { estado: 'vacio' }
  /** El filtro supera el tope por archivo: no se descarga nada y se pide acotar (CA-AUD-03-3). */
  | { estado: 'excede'; total: number }
  | { estado: 'completo'; filas: FilaExportacionActividad[]; total: number }

/** Error de una exportación que no pudo traer todo el filtro: nunca se entrega un archivo parcial. */
export class ExportacionIncompletaError extends Error {}

/**
 * Trae todo el filtro por lotes con cursor (creado_en, id) y el mismo corte, para que las páginas no se corran.
 * El total se pide solo en la primera llamada. Si el filtro supera el tope no baja más filas; si algún lote
 * falta o el conteo final no coincide con el total, lanza (nunca devuelve algo parcial).
 */
export async function traerActividadParaExportar(
  cliente: Pick<SupabaseClient, 'rpc'>,
  filtros: FiltrosActividad,
  /** Id de la corrida: la base registra la constancia en la primera llamada y cierra el id al entregar la última fila (reutilizarlo falla con 22023). El conteo y el tope los lleva la base. */
  exportacion: string = crypto.randomUUID(),
): Promise<ResultadoExportacionActividad> {
  const { desde, hasta } = rangoDelPeriodo(filtros.periodo)
  const texto = filtros.texto.trim()
  const filas: FilaExportacionActividad[] = []
  let corte: string | null = null
  let cursor: RespuestaExportacion['siguiente'] = null
  let total = 0
  for (;;) {
    const primera = corte === null
    const { data, error } = await cliente.rpc('exportar_actividad', {
      p_desde: desde,
      p_hasta: hasta,
      p_empresa: filtros.empresa,
      p_actor: filtros.actor,
      p_tipo: filtros.tipo,
      p_texto: texto === '' ? null : texto,
      p_corte: corte,
      p_cursor_creado_en: cursor?.creado_en ?? null,
      p_cursor_id: cursor?.id ?? null,
      p_limite: LOTE_EXPORTACION_ACTIVIDAD,
      p_exportacion: exportacion,
      p_con_total: primera,
    })
    if (error) throw error
    const respuesta = data as RespuestaExportacion
    corte = respuesta.corte
    if (primera) {
      total = Number(respuesta.total)
      if (total === 0) return { estado: 'vacio' }
      if (total > TOPE_FILAS_ACTIVIDAD) return { estado: 'excede', total }
    }
    filas.push(...respuesta.filas)
    if (!respuesta.hay_mas) break
    if (respuesta.filas.length === 0 || !respuesta.siguiente) {
      throw new ExportacionIncompletaError('La base no entregó el resto de las filas del filtro.')
    }
    cursor = respuesta.siguiente
  }
  if (filas.length !== total) {
    throw new ExportacionIncompletaError(`Se esperaban ${total} filas y llegaron ${filas.length}.`)
  }
  return { estado: 'completo', filas, total }
}

export function descargarCsvActividad(filas: readonly FilaExportacionActividad[], nombre: string = nombreArchivoActividad()): void {
  descargarCsv(armarCsvActividad(filas), nombre)
}
