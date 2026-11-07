import type { SupabaseClient } from '@supabase/supabase-js'
import { etiquetaTipoActividad, formatearCuando, rangoDelPeriodo, tiendaDelEvento, type FiltrosActividad } from './actividad'
import { armarCsv, descargarCsv, nombreArchivoCsv, type ColumnaCsv } from './exportarCsv'

// Exportación de la actividad a CSV (F-AUD-03, MSF-278, FR-011…FR-013). Las filas salen de la RPC
// `exportar_actividad` (mismos filtros que `listar_actividad`), en lotes y con un instante de corte
// estable; acá se arma el CSV con las columnas de la tabla y se descarga. Si algo falla no se
// descarga nada: nunca un archivo parcial.

/** Tope por archivo (RF-AUD-03-3). Lo aplica también la base; acá solo se usa para avisar. */
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
  total: number
  tope: number
  recortado: boolean
  corte: string
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

export type ResultadoExportacionActividad = {
  filas: FilaExportacionActividad[]
  /** Total real del filtro (puede superar el tope). */
  total: number
  /** El filtro tenía más filas que el tope: el archivo trae las primeras. */
  recortado: boolean
}

/** Trae todo el filtro (hasta el tope) por lotes, con el mismo corte para que las páginas no se corran. */
export async function traerActividadParaExportar(
  cliente: Pick<SupabaseClient, 'rpc'>,
  filtros: FiltrosActividad,
): Promise<ResultadoExportacionActividad> {
  const { desde, hasta } = rangoDelPeriodo(filtros.periodo)
  const texto = filtros.texto.trim()
  const filas: FilaExportacionActividad[] = []
  let corte: string | null = null
  let total = 0
  let recortado = false
  for (;;) {
    const { data, error } = await cliente.rpc('exportar_actividad', {
      p_desde: desde,
      p_hasta: hasta,
      p_empresa: filtros.empresa,
      p_actor: filtros.actor,
      p_tipo: filtros.tipo,
      p_texto: texto === '' ? null : texto,
      p_corte: corte,
      p_desplazamiento: filas.length,
      p_limite: LOTE_EXPORTACION_ACTIVIDAD,
    })
    if (error) throw error
    const respuesta = data as RespuestaExportacion
    corte = respuesta.corte
    total = Number(respuesta.total)
    recortado = Boolean(respuesta.recortado)
    filas.push(...respuesta.filas)
    if (respuesta.filas.length === 0 || filas.length >= Math.min(total, TOPE_FILAS_ACTIVIDAD)) break
  }
  return { filas, total, recortado }
}

export function descargarCsvActividad(filas: readonly FilaExportacionActividad[], nombre: string = nombreArchivoActividad()): void {
  descargarCsv(armarCsvActividad(filas), nombre)
}
