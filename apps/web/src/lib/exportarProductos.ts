// Exportación del listado de productos a CSV (F-CAT-11, MSF-382, FR-201…FR-209). Las filas salen de
// `public.exportar_productos` (la base exige Administrador y acceso a Rentabilidad para costo/proveedor);
// acá se piden por páginas de cursor, se arma el CSV y se descarga.
import type { SupabaseClient } from '@supabase/supabase-js'
import { descargarArchivo, neutralizarFormula } from './exportarClientes'
import { BOM_UTF8, FIN_DE_LINEA_CSV, SEPARADOR_CSV } from './exportarCsv'
import { hoyEnOrganizacion } from './periodosRanking'
import { infoDisponibilidad } from './productos'
import type { ConsultaProductos } from './productosListado'

export const TAMANO_PAGINA_EXPORTACION = 500

export type ClaveColumnaExportacion =
  | 'sku' | 'nombre' | 'categoria' | 'precio' | 'costo' | 'stock' | 'visible_en' | 'estado' | 'codigo_barras' | 'proveedor'

export type ColumnaExportacion = {
  clave: ClaveColumnaExportacion
  etiqueta: string
  /** Costo y proveedor: solo se ofrecen con acceso a Rentabilidad (FR-204). */
  requiereRentabilidad: boolean
  porDefecto: boolean
}

export const COLUMNAS_EXPORTACION: ReadonlyArray<ColumnaExportacion> = [
  { clave: 'sku', etiqueta: 'SKU', requiereRentabilidad: false, porDefecto: true },
  { clave: 'nombre', etiqueta: 'Nombre', requiereRentabilidad: false, porDefecto: true },
  { clave: 'categoria', etiqueta: 'Categoría', requiereRentabilidad: false, porDefecto: true },
  { clave: 'precio', etiqueta: 'Precio', requiereRentabilidad: false, porDefecto: true },
  { clave: 'costo', etiqueta: 'Costo', requiereRentabilidad: true, porDefecto: false },
  { clave: 'stock', etiqueta: 'Stock', requiereRentabilidad: false, porDefecto: true },
  { clave: 'visible_en', etiqueta: 'Visible en', requiereRentabilidad: false, porDefecto: true },
  { clave: 'estado', etiqueta: 'Estado', requiereRentabilidad: false, porDefecto: true },
  { clave: 'codigo_barras', etiqueta: 'Código de barras', requiereRentabilidad: false, porDefecto: false },
  { clave: 'proveedor', etiqueta: 'Proveedor', requiereRentabilidad: true, porDefecto: false },
]

export function columnasOfrecidas(veRentabilidad: boolean): ColumnaExportacion[] {
  return COLUMNAS_EXPORTACION.filter((columna) => veRentabilidad || !columna.requiereRentabilidad)
}

/** Las ocho columnas por defecto (FR-204), sin costo ni proveedor. */
export function columnasPorDefecto(veRentabilidad: boolean): ClaveColumnaExportacion[] {
  return columnasOfrecidas(veRentabilidad).filter((columna) => columna.porDefecto).map((columna) => columna.clave)
}

export type FilaExportacionProducto = {
  id: string
  sku?: string | null
  nombre?: string
  categoria?: string | null
  precio?: { monto: number | string; moneda: string } | null
  costo?: { monto: number | string | null } | null
  stock?: string | null
  visible_en?: string[]
  estado?: string
  codigo_barras?: string | null
  proveedor?: string | null
}

type PaginaExportacion = { filas: FilaExportacionProducto[]; siguiente: string | null; total: number }

/** `p_filtros` de `exportar_productos`: «todos» ignora el resto; «filtrado» replica la consulta del listado. */
export function filtrosExportacion(consulta: ConsultaProductos, todos: boolean): Record<string, unknown> {
  if (todos) return { todos: true }
  return {
    busqueda: consulta.texto.trim() || null,
    categoria_id: consulta.categoriaId,
    estado: consulta.estado,
    empresa_id: consulta.empresaId,
    disponibilidad: consulta.disponibilidad,
  }
}

function textoDeCelda(fila: FilaExportacionProducto, clave: ClaveColumnaExportacion): string {
  switch (clave) {
    case 'precio': return fila.precio ? `${fila.precio.moneda} ${fila.precio.monto}` : ''
    case 'costo': return fila.costo?.monto === null || fila.costo?.monto === undefined ? '' : String(fila.costo.monto)
    case 'stock': return infoDisponibilidad(fila.stock)?.etiqueta ?? ''
    case 'visible_en': return (fila.visible_en ?? []).join(', ')
    default: return fila[clave] ?? ''
  }
}

// Escapa comillas, separadores, comas y saltos de línea; todo texto pasa por `neutralizarFormula`
// (celdas que empiezan con = + - @ se anteponen con apóstrofo) antes de escaparse (FR-207).
export function campoCsv(valor: string): string {
  if (valor === '') return ''
  const texto = neutralizarFormula(valor)
  return /[";,\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto
}

export function armarCsvProductos(claves: readonly ClaveColumnaExportacion[], filas: readonly FilaExportacionProducto[]): string {
  const columnas = COLUMNAS_EXPORTACION.filter((columna) => claves.includes(columna.clave))
  const lineas = [
    columnas.map((columna) => campoCsv(columna.etiqueta)).join(SEPARADOR_CSV),
    ...filas.map((fila) => columnas.map((columna) => campoCsv(textoDeCelda(fila, columna.clave))).join(SEPARADOR_CSV)),
  ]
  return BOM_UTF8 + lineas.join(FIN_DE_LINEA_CSV) + FIN_DE_LINEA_CSV
}

export function nombreArchivoProductos(ahora: Date = new Date()): string {
  return `productos-${hoyEnOrganizacion(ahora)}.csv`
}

export class ExportacionCancelada extends Error {
  constructor() {
    super('Exportación cancelada')
    this.name = 'ExportacionCancelada'
  }
}

export type ResultadoExportacion = { csv: string; productos: number; columnas: number }

/** Concatena las páginas de `exportar_productos` y arma el CSV. La actividad la registra la base en la primera página. */
export async function exportarProductos(
  cliente: Pick<SupabaseClient, 'rpc'>,
  opciones: {
    filtros: Record<string, unknown>
    columnas: readonly ClaveColumnaExportacion[]
    alProgresar?: (descargados: number, total: number) => void
    signal?: AbortSignal
  },
): Promise<ResultadoExportacion> {
  const filas: FilaExportacionProducto[] = []
  let desde: string | null = null
  do {
    if (opciones.signal?.aborted) throw new ExportacionCancelada()
    const { data, error } = await cliente.rpc('exportar_productos', {
      p_filtros: opciones.filtros,
      p_columnas: [...opciones.columnas],
      p_desde: desde,
      p_limite: TAMANO_PAGINA_EXPORTACION,
    })
    if (error) throw error
    if (opciones.signal?.aborted) throw new ExportacionCancelada()
    const pagina = data as PaginaExportacion
    filas.push(...pagina.filas)
    opciones.alProgresar?.(filas.length, pagina.total)
    desde = pagina.siguiente
  } while (desde !== null)
  return { csv: armarCsvProductos(opciones.columnas, filas), productos: filas.length, columnas: opciones.columnas.length }
}

export function descargarCsvProductos(csv: string, nombre: string = nombreArchivoProductos()): void {
  descargarArchivo(new Blob([csv], { type: 'text/csv;charset=utf-8' }), nombre)
}
