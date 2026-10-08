import { type OrganizacionActiva } from '../lib/superadmin'
import { useContextoPanel } from './useContextoPanel'

// Resuelve la organización activa del superadmin actual (spec 004, US2) —
// null si no tiene ninguna (nunca entró, o salió). Mismo patrón que
// useIsSuperadmin/usePuedeEscribir: consulta una vez por identidad y cachea
// en estado local, no en cada render.
export function useOrganizacionActiva() {
  const { contexto, isLoading } = useContextoPanel()
  const organizacionActiva: OrganizacionActiva | null = contexto?.es_superadmin
    && contexto.organizacion_id
    && contexto.organizacion_nombre
    ? { id: contexto.organizacion_id, nombre: contexto.organizacion_nombre }
    : null

  return { organizacionActiva, isLoading }
}
