import { coincideRuta, DESTINOS_PANEL } from '../components/navegacion/destinosPanel'
import { AYUDA_POR_DESTINO } from './contenidos'
import type { AyudaPorDestino, ContenidoAyuda } from './tipos'

export const TEXTO_SIN_AYUDA = 'Esta pantalla todavía no tiene ayuda'

export type AyudaResuelta = { destinoId: string | null; contenido: ContenidoAyuda | null }

// FR-022: la ayuda sale del destino del menú que coincide con la ruta, con el mismo criterio de coincidencia que las migas
// de pan (`coincideRuta`). Para subrutas (fichas, formularios) coincide el destino padre. Cuando coinciden varios destinos
// (p. ej. `/stock` y `/stock/movimientos`) gana el MÁS ESPECÍFICO (la ruta más larga): las migas se quedan con el primero
// del menú, pero para la ayuda mostrar la de «Stock» en la pantalla de «Movimientos» sería engañoso.
export function resolverAyuda(pathname: string, ayuda: AyudaPorDestino = AYUDA_POR_DESTINO): AyudaResuelta {
  let mejor: (typeof DESTINOS_PANEL)[number] | null = null
  for (const destino of DESTINOS_PANEL) {
    if (!coincideRuta(destino.ruta, pathname)) continue
    if (mejor === null || destino.ruta.length > mejor.ruta.length) mejor = destino
  }
  if (mejor === null) return { destinoId: null, contenido: null }
  return { destinoId: mejor.id, contenido: ayuda[mejor.id] ?? null }
}
