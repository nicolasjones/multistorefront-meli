import { supabaseClient } from './supabase'
import {
  ErrorExportacion, ExportacionCancelada, neutralizarFormula, TAMANO_LOTE_EXPORTACION,
  type ProgresoExportacion,
} from './exportarClientes'
import {
  argumentosRanking, normalizarFilaRanking, type FilaRanking, type ParametrosRanking,
} from '../hooks/useRankingClientes'

// Exportación del ranking de clientes a .xlsx (F-CLI-09, FR-010/FR-011). Llama
// por lotes a la MISMA `public.ranking_clientes` que la pantalla (la base
// autoriza y acota a la organización); acá solo se arma el archivo.

export const TOPE_FILAS_RANKING = 100_000
export const NOMBRE_HOJA_RANKING = 'Ranking de clientes'

export type ParametrosExportacionRanking = Omit<ParametrosRanking, 'pagina' | 'tamano'>

type FilaServidor = Parameters<typeof normalizarFilaRanking>[0]

type Celda = { type: typeof String | typeof Number; value: string | number; format?: string; fontWeight?: 'bold' } | null

const texto = (valor: string, extra: { fontWeight?: 'bold' } = {}): Celda => ({ type: String, value: neutralizarFormula(valor), ...extra })
const entero = (valor: number): Celda => ({ type: Number, value: valor, format: '0' })
const importe = (valor: number): Celda => ({ type: Number, value: valor, format: '"$" #,##0' })
const porcentaje = (valor: number): Celda => ({ type: Number, value: valor / 100, format: '0.0%' })

const COLUMNAS: ReadonlyArray<{ encabezado: (baseIva: string) => string; celda: (fila: FilaRanking) => Celda; ancho: number }> = [
  { encabezado: () => '#', celda: (f) => entero(f.posicion), ancho: 6 },
  { encabezado: () => 'Cliente', celda: (f) => texto(f.nombre), ancho: 34 },
  { encabezado: () => 'Tipo', celda: (f) => texto(f.tipo === 'mayorista' ? 'Mayorista' : 'Minorista'), ancho: 12 },
  { encabezado: () => 'Comprobantes', celda: (f) => entero(f.comprobantes), ancho: 14 },
  { encabezado: (baseIva) => `Facturado (${baseIva})`, celda: (f) => importe(f.facturado), ancho: 22 },
  { encabezado: () => 'Participación', celda: (f) => porcentaje(f.participacion), ancho: 14 },
]

export const etiquetaBaseIva = (conIva: boolean) => (conIva ? 'con IVA' : 'sin IVA')

// Primera fila: encabezados. Después las filas del ranking y, separado por una
// fila en blanco, el contexto (período y base) y el total facturado.
export function filasPlanillaRanking(filas: readonly FilaRanking[], { desde, hasta, conIva }: Pick<ParametrosRanking, 'desde' | 'hasta' | 'conIva'>) {
  const baseIva = etiquetaBaseIva(conIva)
  const vacias = (cantidad: number): Celda[] => Array.from({ length: cantidad }, () => null)
  const contexto = (etiqueta: string, valor: Celda): Celda[] => [texto(etiqueta, { fontWeight: 'bold' }), valor, ...vacias(COLUMNAS.length - 2)]
  const total = filas.reduce((suma, fila) => suma + fila.facturado, 0)
  return [
    COLUMNAS.map((columna) => texto(columna.encabezado(baseIva), { fontWeight: 'bold' })),
    ...filas.map((fila) => COLUMNAS.map((columna) => columna.celda(fila))),
    vacias(COLUMNAS.length),
    contexto('Período', texto(`${desde} al ${hasta}`)),
    contexto('Base', texto(`Facturado ${baseIva}`)),
    contexto('Total facturado', importe(total)),
  ]
}

async function pedirLote(parametros: ParametrosExportacionRanking, pagina: number): Promise<{ filas: FilaRanking[]; total: number }> {
  const { data, error } = await supabaseClient.rpc('ranking_clientes', argumentosRanking({ ...parametros, pagina, tamano: TAMANO_LOTE_EXPORTACION }))
  if (error) {
    const { code } = error as { code?: string }
    if (code === '42501') throw new ErrorExportacion('No tenés permiso para exportar el ranking.', code)
    console.error('ranking_clientes falló al exportar', error)
    throw new ErrorExportacion('No pudimos exportar el ranking. Intentá de nuevo.', code)
  }
  const recibidas = (data ?? []) as Array<FilaServidor & { total_filas: number | string }>
  return { filas: recibidas.map(normalizarFilaRanking), total: recibidas.length > 0 ? Number(recibidas[0].total_filas) : 0 }
}

// Descarga todas las páginas del ranking vigente y arma el .xlsx. La librería de
// planillas se carga recién acá (import diferido): no pesa en el recorrido principal.
export async function exportarRanking(
  parametros: ParametrosExportacionRanking,
  { alProgresar, signal }: { alProgresar?: (progreso: ProgresoExportacion) => void; signal?: AbortSignal } = {},
): Promise<Blob> {
  const filas: FilaRanking[] = []
  let total = 0
  for (let pagina = 1; ; pagina++) {
    if (signal?.aborted) throw new ExportacionCancelada()
    const lote = await pedirLote(parametros, pagina)
    if (signal?.aborted) throw new ExportacionCancelada()
    if (pagina === 1) {
      total = lote.total
      if (total > TOPE_FILAS_RANKING) {
        throw new ErrorExportacion(`El ranking tiene más de ${TOPE_FILAS_RANKING.toLocaleString('es-AR')} clientes. Acotá el período o los filtros e intentá de nuevo.`, '54000')
      }
    }
    if (lote.filas.length === 0) break
    filas.push(...lote.filas)
    alProgresar?.({ descargados: filas.length, total })
    if (lote.filas.length < TAMANO_LOTE_EXPORTACION || filas.length >= total) break
  }
  if (signal?.aborted) throw new ExportacionCancelada()

  let blob: Blob
  try {
    const { default: escribirXlsx } = await import('write-excel-file/browser')
    blob = await escribirXlsx(
      filasPlanillaRanking(filas, parametros),
      { sheet: NOMBRE_HOJA_RANKING, columns: COLUMNAS.map((columna) => ({ width: columna.ancho })), stickyRowsCount: 1 },
    ).toBlob()
  } catch (error) {
    console.error('armado del .xlsx del ranking falló', error)
    throw new ErrorExportacion('No pudimos armar el archivo. Intentá de nuevo.')
  }
  if (signal?.aborted) throw new ExportacionCancelada()
  return blob
}

export function nombreArchivoRanking({ desde, hasta }: Pick<ParametrosRanking, 'desde' | 'hasta'>): string {
  return `ranking-clientes-${desde}_${hasta}.xlsx`
}
