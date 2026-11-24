import type { ProductoListado } from './tiendaListado'

// Tipo de datos de la home de la tienda pública. Vive aparte de `tiendaInicio.ts` para que el
// proveedor de la fuente (`fuenteTienda.tsx`) no dependa del módulo que la lee: importarlo desde
// ahí cerraba un ciclo de imports (dependency-cruiser, regla `no-circular`).
export type InicioTienda = {
  // La tienda tiene al menos un producto efectivamente visible (distingue «Catálogo en preparación»).
  hayProductos: boolean
  destacados: ProductoListado[]
  // Rutas de imagen → URL firmada (una sola llamada para todos los destacados).
  imagenes: Record<string, string>
}
