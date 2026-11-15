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

// Organización activa + hasta cuándo vale el acceso de soporte (F-OPS-04, FR-015).
export type AccesoSoporte = OrganizacionActiva & { vence_en: string }

// Hora de vencimiento «HH:MM» en Buenos Aires, la misma que registra el historial.
export function formatearVencimiento(venceEn: string): string {
  return new Date(venceEn).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Argentina/Buenos_Aires',
  })
}

// Acceso de soporte vigente del superadmin (null si no tiene o ya venció).
export async function checkAccesoSoporte(userId: string): Promise<AccesoSoporte | null> {
  const { data } = await supabaseClient
    .from('superadmin_organizacion_activa')
    .select('vence_en, organizaciones (id, nombre)')
    .eq('user_id', userId)
    .maybeSingle()

  const organizacion = data?.organizaciones as { id: string; nombre: string } | null | undefined

  if (!data || !organizacion || new Date(data.vence_en).getTime() <= Date.now()) {
    return null
  }

  return { id: organizacion.id, nombre: organizacion.nombre, vence_en: data.vence_en as string }
}

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
    .gt('vence_en', new Date().toISOString()) // un acceso de soporte vencido no cuenta (F-OPS-04)
    .maybeSingle()

  const organizacion = data?.organizaciones as { id: string; nombre: string } | null | undefined

  if (!organizacion) {
    return null
  }

  return { id: organizacion.id, nombre: organizacion.nombre }
}
