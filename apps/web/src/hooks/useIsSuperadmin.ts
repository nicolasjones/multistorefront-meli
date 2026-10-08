import { useContextoPanel } from './useContextoPanel'

// Gate de las pantallas superadmin-only (FR-008, FR-010): organizaciones/*
// existe para un solo perfil. La verificación real de negocio sigue siendo
// la Edge Function/RPC (que rechazan a quien no sea superadmin sin
// importar por dónde entre) — esto es solo para no mostrar la pantalla a
// quien no la puede usar.
export function useIsSuperadmin() {
  const { contexto, isLoading } = useContextoPanel()
  return { isSuperadmin: isLoading ? null : Boolean(contexto?.es_superadmin), isLoading }
}
