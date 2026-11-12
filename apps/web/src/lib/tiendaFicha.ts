import { supabaseClient } from './supabase'
import { esIdValido } from './tiendaListado'
import { limpiarDescripcionPublica, limpiarTextoPublico } from './tiendaTextos'

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
  // F-PRE-11: precio normal, solo cuando hay una promoción vigente.
  precioAnterior?: number | null
  disponible: boolean
  compatibilidad: string | null
  imagenes: ImagenFicha[]
}

type FilaFicha = Omit<FichaProducto, 'precio' | 'precioAnterior' | 'imagenes'> & {
  precio: number | string | null
  precio_anterior?: number | string | null
  imagenes: ImagenFicha[] | null
}

// publico.producto_por_dominio es ejecutable por anon (sin sesión). `null` cubre producto inexistente,
// inactivo, oculto, de categoría oculta, de otra empresa, dominio desconocido o empresa desactivada: el
// front no distingue los casos (FR-050, FR-051). Un id que no es UUID ni llega a la base.
function descripcionDistintaDelNombre(nombre: string, descripcion: string | null): string | null {
  const limpia = limpiarDescripcionPublica(descripcion)
  return limpia !== null && limpiarTextoPublico(limpia).toLowerCase() === limpiarTextoPublico(nombre).toLowerCase() ? null : limpia
}

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
    nombre: limpiarTextoPublico(fila.nombre),
    // Una descripción igual al nombre (así llega de la importación) repetiría el título: se omite (MSF-828).
    descripcion: descripcionDistintaDelNombre(fila.nombre, fila.descripcion),
    sku: fila.sku,
    categoria: fila.categoria,
    precio: fila.precio === null ? null : Number(fila.precio),
    ...(fila.precio_anterior == null ? {} : { precioAnterior: Number(fila.precio_anterior) }),
    disponible: fila.disponible,
    compatibilidad: fila.compatibilidad,
    imagenes: [...(fila.imagenes ?? [])].sort((a, b) => a.posicion - b.posicion),
  }
}
