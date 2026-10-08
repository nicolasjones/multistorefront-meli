import { supabaseClient } from './supabase'

// Compartido entre el hook de UI (useIsSuperadmin) y el
// accessControlProvider (providers/accessControlProvider.ts) — misma
// consulta, dos consumidores distintos.
export async function checkIsSuperadmin(userId: string): Promise<boolean> {
  const { data } = await supabaseClient
    .from('superadmins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()

  return Boolean(data)
}

export type OrganizacionActiva = { id: string; nombre: string }

// Compartido entre el hook de UI (useOrganizacionActiva, spec 004) y el
// accessControlProvider — misma consulta, dos consumidores distintos
// (mismo patrón que checkIsSuperadmin). Devuelve null si el superadmin no
// tiene ninguna organización activa (nunca entró, o salió explícitamente).
export async function checkOrganizacionActiva(
  userId: string,
): Promise<OrganizacionActiva | null> {
  const { data } = await supabaseClient
    .from('superadmin_organizacion_activa')
    .select('organizacion_id, organizaciones (id, nombre)')
    .eq('user_id', userId)
    .maybeSingle()

  const organizacion = data?.organizaciones as { id: string; nombre: string } | null | undefined

  if (!organizacion) {
    return null
  }

  return { id: organizacion.id, nombre: organizacion.nombre }
}
