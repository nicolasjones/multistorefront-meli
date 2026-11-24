import { supabaseClient } from './supabase'
import { limpiarTextoPublico } from './tiendaTextos'

// F-TDA-12 (MSF-355): página del catálogo público. El filtrado, el orden, el precio final y la
// paginación por servidor los resuelve la base (migración 20261023150200_tienda_catalogo_publico.sql); acá solo
// se lee cada tanda y se lee/escribe el estado en la query de la URL (FR-036). MSF-845: el visitante no ve
// páginas numeradas sino carga infinita; `pagina` es solo el número de tanda que se le pide a la RPC y ya no
// forma parte de los filtros ni de la URL (un `?pagina=N` viejo se ignora y se arranca de la primera tanda).

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
}

export const FILTROS_INICIALES: FiltrosCatalogo = {
  categoria: null,
  soloConStock: false,
  precioMax: null,
  orden: 'relevancia',
}

// Filtros activos que cuenta el botón «Filtrar» de celular (F-TDA-17, FR-041): categoría (salvo que la
// fije el path), «Solo con stock» y «Precio máximo». El orden no cuenta.
export function contarFiltrosActivos(filtros: FiltrosCatalogo, categoriaFija: boolean): number {
  return (!categoriaFija && filtros.categoria !== null ? 1 : 0) + (filtros.soloConStock ? 1 : 0) + (filtros.precioMax !== null ? 1 : 0)
}

export type CategoriaListado = { id: string; nombre: string; padreId: string | null; productos: number }

export type ProductoListado = {
  id: string
  nombre: string
  precio: number | null
  // F-PRE-11: precio normal, solo cuando hay una promoción vigente (la base devuelve null si no).
  precioAnterior?: number | null
  disponible: boolean
  imagen: string | null
  categoriaId: string | null
  destacado: boolean
}

export type PaginaCatalogo = {
  // Búsqueda (F-TDA-15, FR-027): segundos hasta poder volver a buscar si el visitante superó el límite.
  esperaSegundos?: number
  total: number
  pagina: number
  tamano: number
  categorias: CategoriaListado[]
  productos: ProductoListado[]
}

export const PAGINA_VACIA: PaginaCatalogo = { total: 0, pagina: 1, tamano: TAMANO_PAGINA, categorias: [], productos: [] }

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
  const orden = params.get('orden')
  const precioMax = max !== null && ENTERO_POSITIVO.test(max) && Number(max) > 0 ? Number(max) : null
  return {
    categoria: categoriaFija ?? (esIdValido(categoriaConsulta) ? categoriaConsulta : null),
    soloConStock: params.get('stock') === '1',
    precioMax,
    orden: OPCIONES_ORDEN.some((o) => o.valor === orden) ? (orden as OrdenCatalogo) : 'relevancia',
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
  return params
}

// Cambiar cualquier filtro u orden reinicia la lista desde la primera tanda (la URL no lleva tanda).
export function conCambio(filtros: FiltrosCatalogo, cambio: Partial<FiltrosCatalogo>): FiltrosCatalogo {
  return { ...filtros, ...cambio }
}

export type FilaPagina = {
  total: number
  pagina: number
  tamano: number
  categorias: Array<{ id: string; nombre: string; padre_id: string | null; productos: number }>
  productos: Array<{
    id: string
    nombre: string
    precio: number | string | null
    precio_anterior?: number | string | null
    disponible: boolean
    imagen: string | null
    categoria_id: string | null
    destacado: boolean
  }>
}

// publico.catalogo_pagina_por_dominio es ejecutable por anon (sin sesión). Dominio desconocido o
// empresa desactivada devuelven null (FR-034): para el front es una tienda sin productos.
export async function leerPaginaCatalogo(host: string, filtros: FiltrosCatalogo, pagina = 1): Promise<PaginaCatalogo> {
  const { data, error } = await supabaseClient.schema('publico').rpc('catalogo_pagina_por_dominio', {
    host,
    categoria: filtros.categoria,
    solo_con_stock: filtros.soloConStock,
    precio_max: filtros.precioMax,
    orden: filtros.orden,
    pagina,
  })
  if (error) {
    throw new Error(error.message)
  }
  if (!data) {
    return PAGINA_VACIA
  }
  return mapearPagina(data as FilaPagina)
}

export function mapearPagina(fila: FilaPagina): PaginaCatalogo {
  return {
    total: fila.total,
    pagina: fila.pagina,
    tamano: fila.tamano,
    // El conteo ya viene acumulado de `publico.categorias_por_dominio` (raíz = suma de sus subcategorías): no se vuelve a sumar.
    categorias: fila.categorias.map((c) => ({ id: c.id, nombre: limpiarTextoPublico(c.nombre), padreId: c.padre_id, productos: c.productos })),
    productos: fila.productos.map((p) => ({
      id: p.id,
      nombre: limpiarTextoPublico(p.nombre),
      precio: p.precio === null ? null : Number(p.precio),
      ...(p.precio_anterior == null ? {} : { precioAnterior: Number(p.precio_anterior) }),
      disponible: p.disponible,
      imagen: p.imagen,
      categoriaId: p.categoria_id,
      destacado: p.destacado,
    })),
  }
}

// Política de precios de la tienda: se muestran AL CENTAVO, igual que el comprobante (la base redondea cada precio final a
// dos decimales con `private.aplicar_iva`). Un precio en pesos justos se muestra sin decimales («$ 18.455», como el
// prototipo) y uno con centavos los muestra siempre con dos («$ 18.455,50»): nunca se redondea al peso. Se agrupa a mano
// porque Intl `es-AR` no agrupa los números de 4 dígitos. Sin precio calculable no se muestra nada (D9).
export function formatearPrecioArs(precio: number | null): string | null {
  if (precio === null) return null
  const centavos = centavosDe(precio)
  const negativo = centavos < 0
  const absoluto = Math.abs(centavos)
  const enteros = Math.trunc(absoluto / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const resto = absoluto % 100
  return `${negativo ? '-' : ''}$ ${enteros}${resto === 0 ? '' : `,${String(resto).padStart(2, '0')}`}`
}

// Un importe en pesos con hasta dos decimales, en centavos enteros (evita acumular errores de coma flotante).
export function centavosDe(importe: number): number {
  return Math.round(importe * 100)
}

// Subtotal de una línea al centavo: precio unitario (ya al centavo) por una cantidad entera.
export function subtotalLinea(precioUnitario: number, cantidad: number): number {
  return (centavosDe(precioUnitario) * cantidad) / 100
}

// Total de referencia de la lista: suma de subtotales de línea en centavos enteros, igual que el presupuesto.
export function totalLista(lineas: ReadonlyArray<{ precioUnitario: number; cantidad: number }>): number {
  return lineas.reduce((suma, linea) => suma + centavosDe(linea.precioUnitario) * linea.cantidad, 0) / 100
}
