import { supabaseClient } from './supabase'

// Compartido entre el hook de UI (useIsSuperadmin) y el
// accessControlProvider (providers/accessControlProvider.ts) — misma
// consulta, dos consumidores distintos.
//
// Un error de la consulta NO es «no es superadmin»: se informa y se deniega (false), y el
// resultado fallido no se cachea (ver `checkIsSuperadmin` más abajo).
async function consultarEsSuperadmin(userId: string): Promise<boolean> {
  const { data, error } = await supabaseClient
    .from('superadmins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return Boolean(data)
}

// `can` de Refine se evalúa por ítem de menú, recurso y acción: sin cache cada evaluación pedía el
// usuario a Auth y consultaba `superadmins`. Se comparte una promesa por usuario (TTL corto, como
// `obtenerPermisosActualesCacheado`) y se descarta al cambiar la sesión. Los fallos no se cachean.
const TTL_ACCESO_MS = 5000
type EntradaCache<T> = { clave?: string; expira: number; promesa: Promise<T> }
let cacheUsuario: EntradaCache<{ id: string } | null> | null = null
let cacheSuperadmin: EntradaCache<boolean> | null = null
let escuchandoSesion = false

export function invalidarCacheAcceso(): void {
  cacheUsuario = null
  cacheSuperadmin = null
}

function escucharCambiosDeSesion(): void {
  if (escuchandoSesion || typeof window === 'undefined') return
  escuchandoSesion = true
  // Cualquier evento de sesión (login, logout, refresh de token, usuario actualizado) invalida:
  // el usuario o su condición de superadmin pudieron cambiar.
  supabaseClient.auth.onAuthStateChange(() => invalidarCacheAcceso())
}

// Usuario autenticado actual (null si no hay sesión o Auth falló: deniega, y no se cachea).
export function obtenerUsuarioActual(): Promise<{ id: string } | null> {
  escucharCambiosDeSesion()
  const ahora = Date.now()
  if (cacheUsuario && cacheUsuario.expira > ahora) {
    return cacheUsuario.promesa
  }
  const promesa = supabaseClient.auth
    .getUser()
    .then(({ data, error }) => (error || !data?.user ? null : { id: data.user.id }))
    .catch(() => null)
  const entrada = { expira: ahora + TTL_ACCESO_MS, promesa }
  cacheUsuario = entrada
  void promesa.then((usuario) => {
    if (usuario === null && cacheUsuario === entrada) {
      cacheUsuario = null
    }
  })
  return promesa
}

export function checkIsSuperadmin(userId: string): Promise<boolean> {
  escucharCambiosDeSesion()
  const ahora = Date.now()
  if (cacheSuperadmin && cacheSuperadmin.clave === userId && cacheSuperadmin.expira > ahora) {
    return cacheSuperadmin.promesa
  }
  const promesa = consultarEsSuperadmin(userId).catch((error: unknown) => {
    // Deny-by-default: ante un error nunca se concede superadmin, y se deja traza.
    console.error('No se pudo consultar superadmins', error instanceof Error ? error.message : error)
    if (cacheSuperadmin === entrada) {
      cacheSuperadmin = null
    }
    return false
  })
  const entrada = { clave: userId, expira: ahora + TTL_ACCESO_MS, promesa }
  cacheSuperadmin = entrada
  return promesa
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
