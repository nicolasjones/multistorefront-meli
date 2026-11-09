// Enlace público de la ficha de un producto (F-TDA-25, FR-023): el origen del Host actual (el dominio de
// la tienda que se está viendo) y la ruta `/producto/<id>`. Sin parámetros de seguimiento, filtro ni
// búsqueda, y sin datos de la persona.
export function enlaceProducto(productoId: string): string {
  return `${window.location.origin}/producto/${encodeURIComponent(productoId)}`
}
