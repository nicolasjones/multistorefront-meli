import { supabaseClient } from './supabase'

// F-TDA-04 (MSF-312): catálogo visible y destacados de la tienda. La visibilidad efectiva, el
// motivo de «no se muestra» y el resumen los calcula la base (migración
// 20261023100300_tienda_catalogo_visible.sql); acá solo se leen y se mandan los cambios.

export type CategoriaTienda = {
  id: string
  nombre: string
  padreId: string | null
  visible: boolean
  productos: number
}

export type ProductoTienda = {
  id: string
  nombre: string
  moneda: string
  precio: number | null
  stock: number
  visible: boolean
  destacado: boolean
  efectivo: boolean
  motivo: string | null
}

export type ResumenCatalogoTienda = { visibles: number; destacados: number }

export type CatalogoTienda = {
  categorias: CategoriaTienda[]
  productos: ProductoTienda[]
  resumen: ResumenCatalogoTienda
}

export type CambiosCatalogoTienda = {
  categorias: Array<{ id: string; visible: boolean }>
  productos: Array<{ id: string; visible: boolean; destacado: boolean }>
}

type FilaCatalogo = {
  categorias: Array<{ id: string; nombre: string; padre_id: string | null; visible: boolean; productos: number }>
  productos: Array<{
    id: string
    nombre: string
    moneda: string
    precio: number | string | null
    stock: number
    visible: boolean
    destacado: boolean
    efectivo: boolean
    motivo: string | null
  }>
  resumen: ResumenCatalogoTienda
}

export async function listarCatalogoTienda(empresaId: string): Promise<CatalogoTienda> {
  const { data, error } = await supabaseClient.rpc('listar_catalogo_tienda', { p_empresa: empresaId })
  if (error) {
    throw new Error(error.message)
  }
  const fila = data as FilaCatalogo
  return {
    categorias: fila.categorias.map((c) => ({
      id: c.id, nombre: c.nombre, padreId: c.padre_id, visible: c.visible, productos: c.productos,
    })),
    productos: fila.productos.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      moneda: p.moneda,
      precio: p.precio === null ? null : Number(p.precio),
      stock: p.stock,
      visible: p.visible,
      destacado: p.destacado,
      efectivo: p.efectivo,
      motivo: p.motivo,
    })),
    resumen: fila.resumen,
  }
}

// Aplica los cambios en una transacción (idempotente) y devuelve el resumen resultante.
export async function guardarCatalogoTienda(empresaId: string, cambios: CambiosCatalogoTienda): Promise<ResumenCatalogoTienda> {
  const { data, error } = await supabaseClient.rpc('guardar_catalogo_tienda', {
    p_empresa: empresaId,
    p_categorias: cambios.categorias,
    p_productos: cambios.productos,
  })
  if (error) {
    throw new Error(error.message)
  }
  return data as ResumenCatalogoTienda
}

export type ProductoPublico = {
  id: string
  nombre: string
  moneda: string
  precio: number | null
  imagenRuta: string | null
  categoriaId: string | null
  destacado: boolean
}

export type CatalogoPublico = {
  categorias: Array<{ id: string; nombre: string; padreId: string | null }>
  productos: ProductoPublico[]
}

type FilaCatalogoPublico = {
  categorias: Array<{ id: string; nombre: string; padre_id: string | null }>
  productos: Array<{
    id: string
    nombre: string
    moneda: string
    precio: number | string | null
    imagen_ruta: string | null
    categoria_id: string | null
    destacado: boolean
  }>
}

// publico.catalogo_visible_por_dominio es ejecutable por anon (sin sesión). Dominio desconocido o
// empresa desactivada devuelven null (FR-049).
export async function leerCatalogoPublico(host: string): Promise<CatalogoPublico | null> {
  const { data, error } = await supabaseClient.schema('publico').rpc('catalogo_visible_por_dominio', { host })
  if (error) {
    throw new Error(error.message)
  }
  if (!data) {
    return null
  }
  const fila = data as FilaCatalogoPublico
  return {
    categorias: fila.categorias.map((c) => ({ id: c.id, nombre: c.nombre, padreId: c.padre_id })),
    productos: fila.productos.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      moneda: p.moneda,
      precio: p.precio === null ? null : Number(p.precio),
      imagenRuta: p.imagen_ruta,
      categoriaId: p.categoria_id,
      destacado: p.destacado,
    })),
  }
}

const formatoPrecio = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Precio de lectura; «—» si no hay precio (FR-047).
export function formatearPrecioTienda(moneda: string, precio: number | null): string {
  return precio === null ? '—' : `${moneda} ${formatoPrecio.format(precio)}`
}
