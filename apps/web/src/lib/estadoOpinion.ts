// Estados de una opinión de producto (MSF-467): el dueño único del dato. Los define la base
// (`dominio.opiniones_producto.estado`) y los comparten el panel (moderación) y la tienda (cuenta del cliente): un
// estado nuevo se agrega UNA sola vez y los dos lados lo aceptan. Con dos listas, el panel descartaría en silencio
// (sin error) toda opinión con el estado nuevo.
export type EstadoOpinion = 'pendiente' | 'aceptada' | 'rechazada'

const ESTADOS: readonly EstadoOpinion[] = ['pendiente', 'aceptada', 'rechazada']

export function esEstadoOpinion(valor: unknown): valor is EstadoOpinion {
  return typeof valor === 'string' && (ESTADOS as readonly string[]).includes(valor)
}
