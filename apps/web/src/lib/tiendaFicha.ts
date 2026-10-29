import { supabaseClient } from './supabase'
import { esIdValido } from './tiendaListado'

// F-TDA-13 (MSF-372): ficha de producto de la tienda pública. Qué producto es visible, su precio final
// y su disponibilidad los decide la base (migración 20261023150300_tienda_ficha_publica.sql); acá solo
// se lee y se acomoda la forma para la pantalla.

export type ImagenFicha = { posicion: number; ruta: string }

export type FichaProducto = {
  id: string
  nombre: string
  descripcion: string | null
  sku: string | null
  categoria: { id: string; nombre: string } | null
  precio: number | null
  disponible: boolean
  compatibilidad: string | null
  imagenes: ImagenFicha[]
}

type FilaFicha = Omit<FichaProducto, 'precio' | 'imagenes'> & {
  precio: number | string | null
  imagenes: ImagenFicha[] | null
}

// publico.producto_por_dominio es ejecutable por anon (sin sesión). `null` cubre producto inexistente,
// inactivo, oculto, de categoría oculta, de otra empresa, dominio desconocido o empresa desactivada: el
// front no distingue los casos (FR-050, FR-051). Un id que no es UUID ni llega a la base.
export async function leerFichaProducto(host: string, productoId: string): Promise<FichaProducto | null> {
  if (!esIdValido(productoId)) return null
  const { data, error } = await supabaseClient.schema('publico').rpc('producto_por_dominio', { host, producto: productoId })
  if (error) {
    throw new Error(error.message)
  }
  if (!data) return null
  const fila = data as FilaFicha
  return {
    id: fila.id,
    nombre: fila.nombre,
    descripcion: fila.descripcion,
    sku: fila.sku,
    categoria: fila.categoria,
    precio: fila.precio === null ? null : Number(fila.precio),
    disponible: fila.disponible,
    compatibilidad: fila.compatibilidad,
    imagenes: [...(fila.imagenes ?? [])].sort((a, b) => a.posicion - b.posicion),
  }
}
