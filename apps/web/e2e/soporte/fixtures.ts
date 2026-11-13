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

/** INSERT por la API REST con la service-role; `ruta` puede llevar `?on_conflict=...` para un upsert. */
export async function rest<T>(ruta: string, cuerpo: unknown, esquema = 'public', prefer = 'return=representation'): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${ruta}`, {
    method: 'POST',
    headers: cabeceras({ prefer, 'content-profile': esquema }),
    body: JSON.stringify(cuerpo),
  })
  if (!r.ok) throw new Error(`REST ${ruta}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T[]
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

async function borrarFilas(ruta: string, esquema: string) {
  const r = await fetch(`${url}/rest/v1/${ruta}`, { method: 'DELETE', headers: cabeceras({ 'content-profile': esquema }) })
  if (!r.ok) console.warn(`limpieza E2E: DELETE ${ruta} → ${r.status}`)
}

/**
 * Baja de una organización de prueba. Cascadea a casi todo, pero NO a los ingresos de mercadería (sus líneas referencian
 * productos con RESTRICT): se borran antes. Si la baja falla (409) se avisa en vez de dejarla en silencio.
 */
export async function limpiarOrganizacion(organizacionId: string) {
  await borrarFilas(`ingresos_mercaderia?organizacion_id=eq.${organizacionId}`, 'dominio')
  await borrarFilas(`organizaciones?id=eq.${organizacionId}`, 'public')
}
