// Listado de productos (F-CAT-01, MSF-252, FR-001/003/004/005). La vista
// `public.v_productos_listado` (migración 20261020120000) es el contrato de lectura; acá se arma la
// consulta: búsqueda, filtro de estado, orden estable y paginación, todo resuelto en el servidor.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Disponibilidad } from './productos'

export const TAMANO_PAGINA_PRODUCTOS = 25
export const LARGO_MAXIMO_BUSQUEDA = 80

export type FiltroEstadoProducto = 'todos' | 'inactivos'
export type ColumnaOrdenProducto = 'nombre' | 'sku' | 'activo'
export type DireccionOrden = 'asc' | 'desc'

export type FilaProductoListado = {
  id: string
  nombre: string
  sku: string | null
  activo: boolean
  imagen_ruta: string | null
  // Empresas que venden el producto (F-CAT-07, FR-012).
  empresa_ids: string[]
  // Categoría (F-CAT-08, FR-022): id y ruta «Padre > Hija»; null si no tiene o no se puede ver.
  categoria_id: string | null
  categoria_ruta: string | null
  // Disponibilidad (F-CAT-17, FR-009): derivada de las existencias o elegida a mano.
  disponibilidad: Disponibilidad
  // Código de barras EAN-13 (F-CAT-14, FR-012): se busca por coincidencia exacta.
  codigo_barras: string | null
}

export type ConsultaProductos = {
  texto: string
  estado: FiltroEstadoProducto
  columnaOrden: ColumnaOrdenProducto
  direccion: DireccionOrden
  pagina: number
  // Filtro de tienda (F-CAT-07, FR-013): null = todas.
  empresaId: string | null
  // Filtro de categoría (F-CAT-08, FR-022): una raíz incluye sus subcategorías. null = todas.
  categoriaId: string | null
  // Filtro de disponibilidad (F-CAT-17, FR-009): null = todas.
  disponibilidad: Disponibilidad | null
}

export const CONSULTA_INICIAL: ConsultaProductos = {
  texto: '',
  estado: 'todos',
  columnaOrden: 'nombre',
  direccion: 'asc',
  pagina: 1,
  empresaId: null,
  categoriaId: null,
  disponibilidad: null,
}

const COLUMNAS = 'id, nombre, sku, activo, imagen_ruta, empresa_ids, categoria_id, categoria_ruta, disponibilidad, codigo_barras'

// Arma el filtro `or` de PostgREST para buscar por nombre o SKU (parcial, sin distinguir
// mayúsculas). Se acota el largo, se quitan los caracteres que separan o agrupan condiciones
// (`,` `(` `)` `"` `\`) y el comodín `*` de PostgREST, y se escapan los comodines de LIKE (`%` `_`), para que lo tipeado
// se busque como texto y no altere la consulta.
export function filtroBusquedaProductos(texto: string): string | null {
  const limpio = texto
    .slice(0, LARGO_MAXIMO_BUSQUEDA)
    .replace(/[,()"\\*]/g, ' ')
    .replace(/[%_]/g, (c) => `\\${c}`)
    .trim()
  if (limpio === '') return null
  return `nombre.ilike.%${limpio}%,sku.ilike.%${limpio}%`
}

// F-CAT-14 (FR-012): un texto de exactamente 13 dígitos es un código de barras (lo que teclea el lector);
// cualquier otro texto sigue por nombre/SKU. Devuelve el código sin espacios extremos, o null.
export function codigoBarrasBuscado(texto: string): string | null {
  const limpio = texto.trim()
  return /^[0-9]{13}$/.test(limpio) ? limpio : null
}

export function hayFiltrosActivos(consulta: ConsultaProductos): boolean {
  return consulta.texto.trim() !== '' || consulta.estado !== 'todos' || consulta.empresaId !== null || consulta.categoriaId !== null || consulta.disponibilidad !== null
}

export type ResultadoProductos = { filas: FilaProductoListado[]; total: number }

export async function consultarProductos(
  cliente: Pick<SupabaseClient, 'from'>,
  consulta: ConsultaProductos,
): Promise<ResultadoProductos> {
  let peticion = cliente.from('v_productos_listado').select(COLUMNAS, { count: 'exact' })
  if (consulta.estado === 'inactivos') peticion = peticion.eq('activo', false)
  // Coincidencia exacta por el índice único (organizacion_id, codigo_barras); si no, nombre/SKU parcial.
  const codigoBarras = codigoBarrasBuscado(consulta.texto)
  const busqueda = codigoBarras ? null : filtroBusquedaProductos(consulta.texto)
  if (codigoBarras) peticion = peticion.eq('codigo_barras', codigoBarras)
  else if (busqueda) peticion = peticion.or(busqueda)
  // Se resuelve en el servidor: `empresa_ids @> {empresa}` sobre la vista.
  if (consulta.empresaId) peticion = peticion.contains('empresa_ids', [consulta.empresaId])
  // `categoria_ids` = [categoría, su padre]: el filtro de una raíz incluye las subcategorías, en el servidor.
  if (consulta.categoriaId) peticion = peticion.contains('categoria_ids', [consulta.categoriaId])
  // Se resuelve en el servidor sobre la columna `disponibilidad` de la vista.
  if (consulta.disponibilidad) peticion = peticion.eq('disponibilidad', consulta.disponibilidad)
  const desde = (consulta.pagina - 1) * TAMANO_PAGINA_PRODUCTOS
  const { data, error, count } = await peticion
    // Nulos explícitos (los mismos que Postgres usa por defecto, compatibles con los índices de orden):
    // al final en ascendente y al principio en descendente.
    .order(consulta.columnaOrden, { ascending: consulta.direccion === 'asc', nullsFirst: consulta.direccion === 'desc' })
    .order('id', { ascending: true })
    .range(desde, desde + TAMANO_PAGINA_PRODUCTOS - 1)
    .returns<FilaProductoListado[]>()
  if (error) throw error
  return { filas: data ?? [], total: count ?? 0 }
}
