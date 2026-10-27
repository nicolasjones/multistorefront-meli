import { supabaseClient } from './supabase'
import {
  ErrorExportacion, ExportacionCancelada, neutralizarFormula, TAMANO_LOTE_EXPORTACION,
  type ProgresoExportacion,
} from './exportarClientes'

// Exportación del ranking de clientes de «Ventas · Reportes» a .xlsx (F-VTA-23, FR-009).
//
// Las filas salen de `public.leer_ranking_ventas`, que lee la MISMA vista que el tablero embebido
// (`analitica.ventas_ranking_clientes`): el Excel y la pantalla no pueden discrepar (SC-004). La
// base autoriza (sección `reportes`) y acota (organización y empresas accesibles del usuario); acá
// solo se arma el archivo.
//
// El texto se neutraliza con `neutralizarFormula` (el mismo helper de F-CLI-09: apóstrofo delante
// de `=`, `+`, `-`, `@`) y cada celda de texto se escribe con `type: String`, para que la planilla
// no interprete el contenido como fórmula.

/** Tope de filas por archivo: más que esto no se exporta (mensaje al usuario, sin archivo a medias). */
export const TOPE_FILAS_RANKING_VENTAS = 100_000
/** Nombre de la hoja del .xlsx. */
export const NOMBRE_HOJA_RANKING_VENTAS = 'Ranking de clientes'

export type ParametrosExportacionRankingVentas = {
  /** Período (ISO): los mismos filtros que muestra la pantalla. */
  desde: string
  hasta: string
  /** «Consumidor final»: por defecto EXCLUIDO, como el interruptor de la pantalla. */
  incluirConsumidorFinal: boolean
  /** Tienda (empresa) filtrada; null = todas las accesibles. */
  empresaId: string | null
}

export type FilaRankingVentas = {
  posicion: number
  cliente_id: string
  numero: number
  nombre: string
  tipo: string
  comprobantes: number
  facturado: number
  participacion: number
  ultimo_comprador: string | null
}

type FilaServidor = {
  [K in keyof FilaRankingVentas]: FilaRankingVentas[K] | string | null
} & { total_filas: number | string }

type Celda =
  | { type: typeof String; value: string; fontWeight?: 'bold' }
  | { type: typeof Number; value: number; format?: string; fontWeight?: 'bold' }
  | null

const texto = (valor: string, extra: { fontWeight?: 'bold' } = {}): Celda => ({
  type: String,
  value: neutralizarFormula(valor),
  ...extra,
})
const entero = (valor: number): Celda => ({ type: Number, value: valor, format: '0' })
const importe = (valor: number): Celda => ({ type: Number, value: valor, format: '"$" #,##0.00' })
const porcentaje = (valor: number): Celda => ({ type: Number, value: valor / 100, format: '0.0%' })

const ETIQUETA_TIPO: Readonly<Record<string, string>> = { minorista: 'Minorista', mayorista: 'Mayorista' }

// Las columnas son las de la tabla del tablero (mismo orden): cliente, número, tipo, posición,
// comprobantes, facturado, participación y último comprador.
const COLUMNAS: ReadonlyArray<{ encabezado: string; celda: (fila: FilaRankingVentas) => Celda; ancho: number }> = [
  { encabezado: 'Cliente', celda: (f) => texto(f.nombre), ancho: 34 },
  { encabezado: 'Nº', celda: (f) => entero(f.numero), ancho: 8 },
  { encabezado: 'Tipo', celda: (f) => texto(ETIQUETA_TIPO[f.tipo] ?? f.tipo), ancho: 12 },
  { encabezado: '#', celda: (f) => entero(f.posicion), ancho: 6 },
  { encabezado: 'Comprobantes', celda: (f) => entero(f.comprobantes), ancho: 14 },
  { encabezado: 'Facturado', celda: (f) => importe(f.facturado), ancho: 20 },
  { encabezado: 'Participación', celda: (f) => porcentaje(f.participacion), ancho: 14 },
  { encabezado: 'Último comprador', celda: (f) => (f.ultimo_comprador ? texto(fechaLegible(f.ultimo_comprador)) : null), ancho: 18 },
]

// La fecha se escribe como texto dd/mm/aaaa: es lo que muestra la pantalla y evita que la planilla
// la corra con la zona horaria del navegador.
function fechaLegible(iso: string): string {
  const [anio, mes, dia] = iso.slice(0, 10).split('-')
  return anio && mes && dia ? `${dia}/${mes}/${anio}` : iso
}

// `numeric` y `bigint` pueden llegar como texto: se normalizan a número.
export const normalizarFilaRankingVentas = (fila: FilaServidor): FilaRankingVentas => ({
  posicion: Number(fila.posicion),
  cliente_id: String(fila.cliente_id),
  numero: Number(fila.numero),
  nombre: String(fila.nombre),
  tipo: String(fila.tipo),
  comprobantes: Number(fila.comprobantes),
  facturado: Number(fila.facturado),
  participacion: Number(fila.participacion),
  ultimo_comprador: fila.ultimo_comprador ? String(fila.ultimo_comprador).slice(0, 10) : null,
})

// Encabezados, las filas del ranking y, separado por una fila en blanco, el contexto (período) y
// los totales (clientes y facturado neto del alcance exportado).
export function filasPlanillaRankingVentas(
  filas: readonly FilaRankingVentas[],
  { desde, hasta, incluirConsumidorFinal }: Pick<ParametrosExportacionRankingVentas, 'desde' | 'hasta' | 'incluirConsumidorFinal'>,
) {
  const vacias = (cantidad: number): Celda[] => Array.from({ length: cantidad }, () => null)
  const contexto = (etiqueta: string, valor: Celda): Celda[] => [texto(etiqueta, { fontWeight: 'bold' }), valor, ...vacias(COLUMNAS.length - 2)]
  const total = filas.reduce((suma, fila) => suma + fila.facturado, 0)
  return [
    COLUMNAS.map((columna) => texto(columna.encabezado, { fontWeight: 'bold' })),
    ...filas.map((fila) => COLUMNAS.map((columna) => columna.celda(fila))),
    vacias(COLUMNAS.length),
    contexto('Período', texto(`${desde} al ${hasta}`)),
    contexto('Consumidor final', texto(incluirConsumidorFinal ? 'Incluido' : 'Excluido')),
    contexto('Clientes', entero(filas.length)),
    contexto('Total facturado', importe(total)),
  ]
}

async function pedirLote(
  parametros: ParametrosExportacionRankingVentas,
  pagina: number,
): Promise<{ filas: FilaRankingVentas[]; total: number }> {
  const { data, error } = await supabaseClient.rpc('leer_ranking_ventas', {
    p_desde: parametros.desde,
    p_hasta: parametros.hasta,
    p_incluir_consumidor_final: parametros.incluirConsumidorFinal,
    p_empresa_id: parametros.empresaId,
    p_pagina: pagina,
    p_tamano: TAMANO_LOTE_EXPORTACION,
  })
  if (error) {
    const { code } = error as { code?: string }
    if (code === '42501') throw new ErrorExportacion('No tenés permiso para exportar el ranking.', code)
    if (code === '22023') throw new ErrorExportacion('Los filtros del período no son válidos.', code)
    console.error('leer_ranking_ventas falló al exportar', error)
    throw new ErrorExportacion('No pudimos exportar el ranking. Intentá de nuevo.', code)
  }
  const recibidas = (data ?? []) as Array<FilaServidor & { total_filas: number | string }>
  return {
    filas: recibidas.map(normalizarFilaRankingVentas),
    total: recibidas.length > 0 ? Number(recibidas[0].total_filas) : 0,
  }
}

// Descarga TODAS las páginas del ranking vigente (por lotes de `TAMANO_LOTE_EXPORTACION`) y arma el
// .xlsx. La librería de planillas se carga recién acá (import diferido): no pesa en el recorrido
// principal.
export async function exportarRankingVentas(
  parametros: ParametrosExportacionRankingVentas,
  { alProgresar, signal }: { alProgresar?: (progreso: ProgresoExportacion) => void; signal?: AbortSignal } = {},
): Promise<Blob> {
  const filas: FilaRankingVentas[] = []
  let total = 0
  for (let pagina = 1; ; pagina++) {
    if (signal?.aborted) throw new ExportacionCancelada()
    const lote = await pedirLote(parametros, pagina)
    if (signal?.aborted) throw new ExportacionCancelada()
    if (pagina === 1) {
      total = lote.total
      if (total > TOPE_FILAS_RANKING_VENTAS) {
        throw new ErrorExportacion(
          `El ranking tiene más de ${TOPE_FILAS_RANKING_VENTAS.toLocaleString('es-AR')} clientes. Acotá el período o los filtros e intentá de nuevo.`,
          '54000',
        )
      }
      if (total === 0) {
        throw new ErrorExportacion('No hay clientes en el ranking con esos filtros.', 'VACIO')
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
      filasPlanillaRankingVentas(filas, parametros),
      {
        sheet: NOMBRE_HOJA_RANKING_VENTAS,
        columns: COLUMNAS.map((columna) => ({ width: columna.ancho })),
        stickyRowsCount: 1,
      },
    ).toBlob()
  } catch (error) {
    console.error('armado del .xlsx del ranking de ventas falló', error)
    throw new ErrorExportacion('No pudimos armar el archivo. Intentá de nuevo.')
  }
  if (signal?.aborted) throw new ExportacionCancelada()
  return blob
}

export function nombreArchivoRankingVentas({ desde, hasta }: Pick<ParametrosExportacionRankingVentas, 'desde' | 'hasta'>): string {
  return `ranking-clientes-ventas-${desde}_${hasta}.xlsx`
}
