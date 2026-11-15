// Soporte común de los E2E con siembra por la API admin (la service-role key nunca llega al navegador). Solo contra un
// Supabase local. Los archivos de `soporte/` no son specs (el `testMatch` es `**/*.e2e.ts`).
export const url = process.env.SUPABASE_URL
export const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
}

export const cabeceras = (extra: Record<string, string> = {}) => ({
  apikey: serviceKey ?? '',
  authorization: `Bearer ${serviceKey}`,
  'content-type': 'application/json',
  ...extra,
})

/** `Prefer` de un upsert que pisa la fila existente (p. ej. la que el disparador de productos ya creó). */
export const UPSERT_FUSIONAR = 'return=representation,resolution=merge-duplicates'

/**
 * INSERT por la API REST con la service-role; `ruta` puede llevar `?on_conflict=...` para un upsert. Con un `prefer` que no
 * pide `return=representation` (p. ej. `return=minimal`) no hay cuerpo que leer y devuelve `[]`.
 */
export async function rest<T>(ruta: string, cuerpo: unknown, esquema = 'public', prefer = 'return=representation'): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${ruta}`, {
    method: 'POST',
    headers: cabeceras({ prefer, 'content-profile': esquema }),
    body: JSON.stringify(cuerpo),
  })
  if (!r.ok) throw new Error(`REST ${ruta}: ${r.status} ${await r.text()}`)
  return prefer.includes('return=representation') ? ((await r.json()) as T[]) : []
}

/** SELECT por la API REST con la service-role (`ruta` lleva el filtro: `tabla?select=...&col=eq.x`). */
export async function leer<T>(ruta: string, esquema = 'public'): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${ruta}`, { headers: cabeceras({ 'accept-profile': esquema }) })
  if (!r.ok) throw new Error(`REST GET ${ruta}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T[]
}

/** DELETE por la API REST (`ruta` lleva el filtro). Si falla avisa con `console.warn` y sigue: es limpieza. */
export async function borrar(ruta: string, esquema = 'public') {
  const r = await fetch(`${url}/rest/v1/${ruta}`, { method: 'DELETE', headers: cabeceras({ 'content-profile': esquema }) })
  if (!r.ok) console.warn(`limpieza E2E: DELETE ${ruta} → ${r.status}`)
}

/** Contraseña con la que los specs dan de alta a sus personas de prueba. */
export const CONTRASENA_E2E = 'Correcta-12345!'

/** Alta de una persona por la API admin de Auth (correo confirmado). Devuelve su id. */
export async function altaUsuario(correo: string, password = CONTRASENA_E2E): Promise<string> {
  const r = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: cabeceras(),
    body: JSON.stringify({ email: correo, password, email_confirm: true }),
  })
  if (!r.ok) throw new Error(`alta de ${correo}: ${r.status} ${await r.text()}`)
  return ((await r.json()) as { id: string }).id
}

/** Baja de una persona por la API admin de Auth. Si falla avisa con `console.warn` y sigue: es limpieza. */
export async function borrarUsuario(id: string) {
  const r = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: cabeceras() })
  if (!r.ok) console.warn(`limpieza E2E: baja de usuario ${id} → ${r.status}`)
}

/**
 * Alta de una consulta como la de la tienda: `service_role` solo LEE `dominio.consultas`, así que entra por la RPC pública
 * (la empresa se resuelve por el dominio de `dominio.tiendas`). Devuelve el id de la consulta.
 */
export async function crearConsulta(
  host: string,
  { nombre, contacto, mensaje = 'Hola, ¿tienen stock?', origen = 'formulario' }: { nombre: string; contacto: string; mensaje?: string | null; origen?: 'formulario' | 'whatsapp' },
): Promise<string> {
  const r = await fetch(`${url}/rest/v1/rpc/crear_consulta_publica`, {
    method: 'POST',
    headers: cabeceras({ 'content-profile': 'publico' }),
    body: JSON.stringify({ host, origen, nombre, contacto, mensaje }),
  })
  if (!r.ok) throw new Error(`crear_consulta_publica: ${r.status} ${await r.text()}`)
  return (await r.json()) as string
}

/**
 * Baja de una organización de prueba. Cascadea a casi todo, pero NO a los ingresos de mercadería (sus líneas referencian
 * productos con RESTRICT): se borran antes. Si la baja falla (409) se avisa en vez de dejarla en silencio.
 */
export async function limpiarOrganizacion(organizacionId: string) {
  await borrar(`ingresos_mercaderia?organizacion_id=eq.${organizacionId}`, 'dominio')
  await borrar(`organizaciones?id=eq.${organizacionId}`, 'public')
}
