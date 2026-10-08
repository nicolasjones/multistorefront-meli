import { useContextoPanel } from './useContextoPanel'

// Espejo, del lado del cliente y solo para gatear la UI, de
// private.puede_escribir(): administrador de su organización, o
// superadmin con una organización activa (US3, FR-011). La autorización
// real la sigue haciendo RLS — esto solo evita mostrar controles que el
// servidor de todas formas va a rechazar.
export function usePuedeEscribir() {
  const { contexto, isLoading } = useContextoPanel()
  return { puedeEscribir: isLoading ? null : Boolean(contexto?.puede_escribir), isLoading }
}
