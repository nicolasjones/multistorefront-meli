import { supabaseClient } from './supabase'

// F-TDA-12 (MSF-355): página del catálogo público. El filtrado, el orden, el precio final y la
// paginación los resuelve la base (migración 20261023150200_tienda_catalogo_publico.sql); acá solo se
// lee la página y se lee/escribe el estado en la query de la URL (FR-036).

export const TAMANO_PAGINA = 24

export type OrdenCatalogo = 'relevancia' | 'precio_asc' | 'precio_desc'

export const OPCIONES_ORDEN: ReadonlyArray<{ valor: OrdenCatalogo; etiqueta: string }> = [
  { valor: 'relevancia', etiqueta: 'Más relevantes' },
  { valor: 'precio_asc', etiqueta: 'Menor precio' },
  { valor: 'precio_desc', etiqueta: 'Mayor precio' },
]

export type FiltrosCatalogo = {
  categoria: string | null
  soloConStock: boolean
  precioMax: number | null
  orden: OrdenCatalogo
  pagina: number
}

export const FILTROS_INICIALES: FiltrosCatalogo = {
  categoria: null,
  soloConStock: false,
  precioMax: null,
  orden: 'relevancia',
  pagina: 1,
}

export type CategoriaListado = { id: string; nombre: string; padreId: string | null; productos: number }

export type ProductoListado = {
  id: string
  nombre: string
  precio: number | null
  disponible: boolean
  imagen: string | null
  categoriaId: string | null
  destacado: boolean
}

export type PaginaCatalogo = {
  total: number
  pagina: number
  tamano: number
  categorias: CategoriaListado[]
  productos: ProductoListado[]
}

const PAGINA_VACIA: PaginaCatalogo = { total: 0, pagina: 1, tamano: TAMANO_PAGINA, categorias: [], productos: [] }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ENTERO_POSITIVO = /^[0-9]{1,9}$/

export function esIdValido(valor: string | null | undefined): valor is string {
  return typeof valor === 'string' && UUID.test(valor)
}

// Query → filtros. Todo valor inválido se ignora (queda el valor inicial), nunca da error (FR-036).
// `categoriaFija` es la de `/categoria/:categoriaId`: manda sobre `?categoria=`.
export function parsearFiltros(params: URLSearchParams, categoriaFija: string | null = null): FiltrosCatalogo {
  const categoriaConsulta = params.get('categoria')
  const max = params.get('max')
  const pagina = params.get('pagina')
  const orden = params.get('orden')
  const precioMax = max !== null && ENTERO_POSITIVO.test(max) && Number(max) > 0 ? Number(max) : null
  const numeroPagina = pagina !== null && ENTERO_POSITIVO.test(pagina) ? Number(pagina) : 1
  return {
    categoria: categoriaFija ?? (esIdValido(categoriaConsulta) ? categoriaConsulta : null),
    soloConStock: params.get('stock') === '1',
    precioMax,
    orden: OPCIONES_ORDEN.some((o) => o.valor === orden) ? (orden as OrdenCatalogo) : 'relevancia',
    pagina: numeroPagina >= 1 ? numeroPagina : 1,
  }
}

// Filtros → query: solo lo que difiere del valor inicial. `incluirCategoria: false` para la ruta
// `/categoria/:id`, donde la categoría va en el path.
export function serializarFiltros(filtros: FiltrosCatalogo, incluirCategoria = true): URLSearchParams {
  const params = new URLSearchParams()
  if (incluirCategoria && filtros.categoria) params.set('categoria', filtros.categoria)
  if (filtros.soloConStock) params.set('stock', '1')
  if (filtros.precioMax !== null) params.set('max', String(filtros.precioMax))
  if (filtros.orden !== 'relevancia') params.set('orden', filtros.orden)
  if (filtros.pagina > 1) params.set('pagina', String(filtros.pagina))
  return params
}

// Cambiar cualquier filtro u orden vuelve a la página 1; cambiar solo la página no (FR-036).
export function conCambio(filtros: FiltrosCatalogo, cambio: Partial<Omit<FiltrosCatalogo, 'pagina'>>): FiltrosCatalogo {
  return { ...filtros, ...cambio, pagina: 1 }
}

type FilaPagina = {
  total: number
  pagina: number
  tamano: number
  categorias: Array<{ id: string; nombre: string; padre_id: string | null; productos: number }>
  productos: Array<{
    id: string
    nombre: string
    precio: number | string | null
    disponible: boolean
    imagen: string | null
    categoria_id: string | null
    destacado: boolean
  }>
}

// publico.catalogo_pagina_por_dominio es ejecutable por anon (sin sesión). Dominio desconocido o
// empresa desactivada devuelven null (FR-034): para el front es una tienda sin productos.
export async function leerPaginaCatalogo(host: string, filtros: FiltrosCatalogo): Promise<PaginaCatalogo> {
  const { data, error } = await supabaseClient.schema('publico').rpc('catalogo_pagina_por_dominio', {
    host,
    categoria: filtros.categoria,
    solo_con_stock: filtros.soloConStock,
    precio_max: filtros.precioMax,
    orden: filtros.orden,
    pagina: filtros.pagina,
  })
  if (error) {
    throw new Error(error.message)
  }
  if (!data) {
    return PAGINA_VACIA
  }
  const fila = data as FilaPagina
  return {
    total: fila.total,
    pagina: fila.pagina,
    tamano: fila.tamano,
    categorias: fila.categorias.map((c) => ({ id: c.id, nombre: c.nombre, padreId: c.padre_id, productos: c.productos })),
    productos: fila.productos.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      precio: p.precio === null ? null : Number(p.precio),
      disponible: p.disponible,
      imagen: p.imagen,
      categoriaId: p.categoria_id,
      destacado: p.destacado,
    })),
  }
}

// «$ 18.455»: pesos enteros con punto de miles (es-AR). Se agrupa a mano porque Intl `es-AR` no agrupa
// los números de 4 dígitos. Sin precio calculable no se muestra nada (D9).
export function formatearPrecioArs(precio: number | null): string | null {
  if (precio === null) return null
  return `$ ${Math.round(precio).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
}
