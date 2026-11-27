// MSF-1002: qué tarjetas de una grilla cargan su imagen sin diferir. En celular se ven 2 columnas y la primera fila (2 tarjetas)
// queda sin desplazar: esas dos no llevan `loading="lazy"`; la primera pide además `fetchpriority="high"` (es el candidato a LCP).
// Un índice fuera de rango (negativo o NaN) no recibe prioridad.
export const TARJETAS_CON_PRIORIDAD = 2

export type PrioridadImagen = 'alta' | 'normal'

export function prioridadDeTarjeta(indice: number): PrioridadImagen | undefined {
  if (!Number.isInteger(indice) || indice < 0 || indice >= TARJETAS_CON_PRIORIDAD) return undefined
  return indice === 0 ? 'alta' : 'normal'
}
