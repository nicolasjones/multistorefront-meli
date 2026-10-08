import { useContextoPanel } from './useContextoPanel'

// Resuelve la organización sobre la que trabaja la pantalla: la membresía
// propia tiene prioridad y, para un superadmin, se usa la organización activa.
// Es el mismo orden que private.organizacion_id() y evita que un superadmin
// vea o modifique todas las filas que su RLS le permite administrar.
export function useOrganizacionDeTrabajo() {
  const { contexto, isLoading } = useContextoPanel()
  return { organizacionId: contexto?.organizacion_id ?? null, isLoading }
}
