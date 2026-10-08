import { supabaseClient } from './supabase'

// Compartido entre el hook de UI (useFeatureHabilitada) y el
// accessControlProvider (providers/accessControlProvider.ts) — mismo
// patrón que checkIsSuperadmin (lib/superadmin.ts). Delega la resolución
// de "organización efectiva" (membresía directa vs. superadmin con
// organización activa) al RPC tiene_feature_publica, que a su vez delega
// en private.tiene_feature (contracts/gestion-funcionalidades.md) — nunca
// resuelve nada de eso acá. Devuelve false ante cualquier error (fail
// closed, FR-003), en vez de dejar que un error de red habilite algo.
export async function checkFeatureHabilitada(featureId: string): Promise<boolean> {
  const { data, error } = await supabaseClient.rpc('tiene_feature_publica', {
    p_feature_id: featureId,
  })

  if (error) {
    return false
  }

  return Boolean(data)
}
