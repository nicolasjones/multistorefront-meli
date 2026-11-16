import { supabaseClient } from './supabase'
import { guardarBorrador, obtenerBorrador } from './tiendaBorrador'

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

// «Guardar» deja los cambios en el borrador (F-TDA-06): se suman a los que ya había (lo último gana por
// elemento) y la tienda pública no cambia hasta publicar. La visibilidad efectiva se relee con
// `listarCatalogoTienda`, que ya superpone el borrador.
export async function guardarCatalogoTienda(empresaId: string, cambios: CambiosCatalogoTienda): Promise<void> {
  const actual = (await obtenerBorrador(empresaId)).catalogo
  const categorias = new Map((actual?.categorias ?? []).map((c) => [c.id, c]))
  const productos = new Map((actual?.productos ?? []).map((p) => [p.id, p]))
  for (const c of cambios.categorias) categorias.set(c.id, c)
  for (const p of cambios.productos) productos.set(p.id, p)
  await guardarBorrador(empresaId, 'catalogo', { categorias: [...categorias.values()], productos: [...productos.values()] })
}

const formatoPrecio = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Precio de lectura; «—» si no hay precio (FR-047).
export function formatearPrecioTienda(moneda: string, precio: number | null): string {
  return precio === null ? '—' : `${moneda} ${formatoPrecio.format(precio)}`
}
