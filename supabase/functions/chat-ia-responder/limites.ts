// Tope de filas que el chat entrega al modelo en cada lectura (F-IA-01, FR-023, D-8). Sin imports de Deno ni de Supabase:
// se prueba con `node --test` (`pnpm test:edge:chat-ia-limites`).
export const TOPE_FILAS_CONSULTA = 50

export type FilasAcotadas<T> = { filas: T[]; truncado: boolean; aviso?: string }

/**
 * Acota las filas leídas a `tope`. La lectura pide `tope + 1` filas: si llega la de más, hay resultados que no se
 * muestran y el asistente recibe un aviso claro para pedir al usuario que afine la búsqueda en vez de inventar el resto.
 */
export function acotarFilas<T>(filas: readonly T[] | null | undefined, tope: number = TOPE_FILAS_CONSULTA): FilasAcotadas<T> {
  const lista = filas ?? []
  if (lista.length <= tope) return { filas: [...lista], truncado: false }
  return {
    filas: lista.slice(0, tope),
    truncado: true,
    aviso: `Hay más de ${tope} resultados y solo se muestran los primeros ${tope}. Pedile al usuario que afine la búsqueda (por ejemplo por SKU, nombre o fecha).`,
  }
}
