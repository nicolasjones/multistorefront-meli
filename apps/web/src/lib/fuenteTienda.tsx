import { createContext, useContext } from 'react'
import { urlsImagenesProducto } from './imagenProducto'
import { aContenido, type ContenidoTienda } from './tiendaContenido'
import { identidadDesdeFila, type FilaIdentidad, type IdentidadTienda } from './tiendaIdentidad'
import type { VistaPreviaTienda } from './tiendaBorrador'
import type { CategoriaPublica } from './tiendaCategorias'
import type { InicioTienda } from './tiendaInicio'

// F-TDA-06 (FR-060): fuente de datos inyectable de las secciones de la home pública. Por defecto (sin proveedor)
// cada sección lee `publico.*` por host; la vista previa de la gestión la reemplaza con lo que devuelve
// `public.vista_previa_tienda` (borrador sobre lo publicado). Así lo que se previsualiza es lo que se publica y
// ninguna sección de la vista previa lee `publico.*`.
export type FuenteTienda = {
  identidad: IdentidadTienda
  contenido: ContenidoTienda
  inicio: InicioTienda
  categorias: CategoriaPublica[]
}

const FuenteTiendaContext = createContext<FuenteTienda | null>(null)

export const ProveedorFuenteTienda = FuenteTiendaContext.Provider

// null = tienda pública real (cada sección lee por host).
export function useFuenteTienda(): FuenteTienda | null {
  return useContext(FuenteTiendaContext)
}

// Convierte la respuesta de la vista previa a la forma que usan las secciones (incluye firmar las imágenes de los
// destacados, como hace la tienda pública).
export async function fuenteDesdeVistaPrevia(vista: VistaPreviaTienda): Promise<FuenteTienda> {
  const destacados = vista.destacados.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    precio: p.precio,
    disponible: p.disponible,
    imagen: p.imagen,
    categoriaId: p.categoriaId,
    destacado: true,
  }))
  const imagenes = await urlsImagenesProducto(destacados.flatMap((p) => (p.imagen ? [p.imagen] : [])))
  return {
    identidad: identidadDesdeFila(vista.identidad as unknown as FilaIdentidad),
    contenido: aContenido(vista.contenido),
    inicio: { hayProductos: vista.hayProductos, destacados, imagenes },
    categorias: vista.categorias,
  }
}
