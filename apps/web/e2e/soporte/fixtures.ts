// Soporte común de los E2E con siembra por la API admin (la service-role key nunca llega al navegador). Solo contra un
// Supabase local. Los archivos de `soporte/` no son specs (el `testMatch` es `**/*.e2e.ts`).
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-expect-error módulo .mjs sin tipos; es la misma lógica de puertos que usa el CI (`verificarDestinoCi`)
import { derivarStackCi, leerConfigDesarrollo } from '../../../../scripts/supabase-ci.mjs'

export const url = process.env.SUPABASE_URL
export const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']

type Desarrollo = { projectId: string; puertos: Record<string, number> }
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
let desarrolloCache: Desarrollo | undefined
/** Config del stack de DESARROLLO (supabase/config.toml): de ahí salen los puertos prohibidos y los del stack efímero. */
function leerDesarrollo(): Desarrollo {
  return (desarrolloCache ??= leerConfigDesarrollo(readFileSync(resolve(RAIZ, 'supabase/config.toml'), 'utf8')) as Desarrollo)
}

/**
 * Guarda de «solo Supabase local» para `SUPABASE_URL`: host local y, además, un puerto que NO sea de un stack de desarrollo
 * (config.toml); si el job declara `SUPABASE_CI_PROJECT_ID` (stack efímero del CI), el puerto debe ser el de la API derivada
 * de esa ranura, igual que `verificarDestinoCi`. Pura: lanza o no hace nada.
 */
export function validarUrlSupabase(urlTexto: string, env: Record<string, string | undefined>, desarrollo: Desarrollo = leerDesarrollo()) {
  const u = new URL(urlTexto)
  if (!HOSTS_LOCALES.includes(u.hostname)) {
    throw new Error(`E2E: SUPABASE_URL (${u.hostname}) no es un Supabase local; se aborta.`)
  }
  const puerto = Number(u.port || (u.protocol === 'https:' ? 443 : 80))
  if (Object.values(desarrollo.puertos).includes(puerto)) {
    throw new Error(`E2E: SUPABASE_URL usa el puerto ${puerto}, que es de un stack de desarrollo; se aborta.`)
  }
  if (env.SUPABASE_CI_PROJECT_ID) {
    const esperado = derivarStackCi(desarrollo, env.GITHUB_REPOSITORY, env.SUPABASE_CI_RANURA)
    if (env.SUPABASE_CI_PROJECT_ID.trim() !== esperado.projectId || puerto !== esperado.puertos['api.port']) {
      throw new Error(`E2E: SUPABASE_URL (puerto ${puerto}) no es la API del stack del CI (${esperado.puertos['api.port']}); se aborta.`)
    }
  }
}
if (url) validarUrlSupabase(url, process.env)

export const cabeceras = (extra: Record<string, string> = {}) => ({
  apikey: serviceKey ?? '',
  authorization: `Bearer ${serviceKey}`,
  'content-type': 'application/json',
  ...extra,
})

/** `Prefer` de un upsert que pisa la fila existente (p. ej. la que el disparador de productos ya creó). */
export const UPSERT_FUSIONAR = 'return=representation,resolution=merge-duplicates'

// `clientes` vive en `dominio` (MSF-882): PostgREST elige el esquema por el perfil, no por el search_path. Las tablas que
// siguen en `public` (`clientes_empresas`, `clientes_identificadores_externos`) no coinciden con este patrón.
export const esquemaDe = (ruta: string, esquema: string) => (esquema === 'public' && /^clientes(\?|$)/.test(ruta) ? 'dominio' : esquema)

/**
 * INSERT por la API REST con la service-role; `ruta` puede llevar `?on_conflict=...` para un upsert. Con un `prefer` que no
 * pide `return=representation` (p. ej. `return=minimal`) no hay cuerpo que leer y devuelve `[]`.
 */
export async function rest<T>(ruta: string, cuerpo: unknown, esquema = 'public', prefer = 'return=representation'): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${ruta}`, {
    method: 'POST',
    headers: cabeceras({ prefer, 'content-profile': esquemaDe(ruta, esquema) }),
    body: JSON.stringify(cuerpo),
  })
  if (!r.ok) throw new Error(`REST ${ruta}: ${r.status} ${await r.text()}`)
  return prefer.includes('return=representation') ? ((await r.json()) as T[]) : []
}

/** SELECT por la API REST con la service-role (`ruta` lleva el filtro: `tabla?select=...&col=eq.x`). */
export async function leer<T>(ruta: string, esquema = 'public'): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${ruta}`, { headers: cabeceras({ 'accept-profile': esquemaDe(ruta, esquema) }) })
  if (!r.ok) throw new Error(`REST GET ${ruta}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T[]
}

/** DELETE por la API REST (`ruta` lleva el filtro). Si falla avisa con `console.warn` y sigue: es limpieza. */
export async function borrar(ruta: string, esquema = 'public') {
  const r = await fetch(`${url}/rest/v1/${ruta}`, { method: 'DELETE', headers: cabeceras({ 'content-profile': esquemaDe(ruta, esquema) }) })
  if (!r.ok) console.warn(`limpieza E2E: DELETE ${ruta} → ${r.status}`)
}

/** Contraseña con la que los specs dan de alta a sus personas de prueba. */
export const CONTRASENA_E2E = 'Correcta-12345!'

/**
 * Alta de una persona por la API admin de Auth (correo confirmado). Devuelve su id. Con `password = null` la persona nace SIN
 * contraseña (la invitación pendiente de definirla).
 */
export async function altaUsuario(correo: string, password: string | null = CONTRASENA_E2E): Promise<string> {
  const r = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: cabeceras(),
    body: JSON.stringify({ email: correo, email_confirm: true, ...(password === null ? {} : { password }) }),
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
 * Asigna empresas y rol por empresa a una persona como lo hace la pantalla de Usuarios: `service_role` no escribe en
 * `public.usuarios_empresas` (su único camino de escritura es la RPC `asignar_empresas_usuario` del Administrador de la
 * organización), así que la RPC se llama con la sesión de un Administrador ya sembrado. La RPC reemplaza las asignaciones de
 * la persona y fija la primera empresa como activa si no tenía una válida.
 */
export async function asignarEmpresasComoAdministrador(
  correoAdmin: string,
  usuarioId: string,
  asignaciones: { empresa_id: string; rol_id: string }[],
  password = CONTRASENA_E2E,
) {
  const claveAnonima = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!claveAnonima) throw new Error('Falta la clave anónima (VITE_SUPABASE_PUBLISHABLE_KEY)')
  const sesion = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: claveAnonima, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: correoAdmin, password }),
  })
  if (!sesion.ok) throw new Error(`Login de ${correoAdmin}: ${sesion.status} ${await sesion.text()}`)
  const { access_token: token } = (await sesion.json()) as { access_token: string }
  const r = await fetch(`${url}/rest/v1/rpc/asignar_empresas_usuario`, {
    method: 'POST',
    headers: { apikey: claveAnonima, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_target_user_id: usuarioId, p_asignaciones: asignaciones }),
  })
  if (!r.ok) throw new Error(`RPC asignar_empresas_usuario: ${r.status} ${await r.text()}`)
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

type ClientePg = { connect(): Promise<void>; query(sql: string, valores?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>; end(): Promise<void> }

export type DestinoSql = { host: string; port: number; database: string; user: string; password: string }

/**
 * Valida el destino de `sql()` (pura, sin conexión). `sql()` corre como superusuario `postgres`: por eso exige que el host
 * sea local (el mismo criterio que `SUPABASE_URL`), que el puerto sea EXPLÍCITO (`E2E_PGPORT` o el puente de CI
 * `SUPABASE_DB_PORT`; sin default silencioso, porque el 54322 puede ser el stack de dev del servidor y no el efímero) y que la
 * base y el usuario sean los del stack efímero (`postgres`). Lanza un error claro si algo no cumple.
 */
export function validarDestinoSql(env: Record<string, string | undefined>, desarrollo: Desarrollo = leerDesarrollo()): DestinoSql {
  const host = env.E2E_PGHOST ?? '127.0.0.1'
  if (!HOSTS_LOCALES.includes(host)) {
    throw new Error(`E2E sql(): E2E_PGHOST (${host}) no es local (${HOSTS_LOCALES.join(', ')}); se aborta para no escribir en una base real.`)
  }
  const texto = env.E2E_PGPORT ?? env.SUPABASE_DB_PORT
  const puerto = Number(texto)
  if (!texto || !/^\d+$/.test(texto) || puerto < 1 || puerto > 65535) {
    throw new Error('E2E sql(): falta el puerto de Postgres del stack efímero (o está fuera de rango); define E2E_PGPORT o SUPABASE_DB_PORT. No hay puerto por defecto.')
  }
  if (env.E2E_PGPORT && env.SUPABASE_DB_PORT && env.E2E_PGPORT !== env.SUPABASE_DB_PORT) {
    throw new Error(`E2E sql(): E2E_PGPORT (${env.E2E_PGPORT}) y SUPABASE_DB_PORT (${env.SUPABASE_DB_PORT}) no coinciden.`)
  }
  if (Object.values(desarrollo.puertos).includes(puerto)) {
    throw new Error(`E2E sql(): el puerto ${puerto} es de un stack de desarrollo; sql() solo escribe en el stack efímero del CI.`)
  }
  // Como `verificarDestinoCi`: el stack debe estar preparado (`pnpm db:ci:preparar`) y el puerto ser el de su base derivada.
  const projectId = env.SUPABASE_CI_PROJECT_ID?.trim()
  if (!projectId) throw new Error('E2E sql(): falta SUPABASE_CI_PROJECT_ID; prepara el stack efímero con `pnpm db:ci:preparar`.')
  const esperado = derivarStackCi(desarrollo, env.GITHUB_REPOSITORY, env.SUPABASE_CI_RANURA)
  if (projectId !== esperado.projectId || puerto !== esperado.puertoDb) {
    throw new Error(`E2E sql(): el puerto ${puerto} / project ${projectId} no es el stack del CI (${esperado.projectId}, base ${esperado.puertoDb}).`)
  }
  const database = env.E2E_PGDATABASE ?? 'postgres'
  if (database !== 'postgres') throw new Error(`E2E sql(): E2E_PGDATABASE (${database}) debe ser «postgres», la base del stack efímero.`)
  const user = env.E2E_PGUSER ?? 'postgres'
  if (user !== 'postgres') throw new Error(`E2E sql(): E2E_PGUSER (${user}) debe ser «postgres».`)
  return { host, port: puerto, database, user, password: env.E2E_PGPASSWORD ?? 'postgres' }
}

// `pg` es dependencia del worker, no de la web: se resuelve desde el paquete del worker, relativo a este archivo, y se cachea.
let requirePg: NodeRequire | undefined
function cargarPg(): { Client: new (config: Record<string, unknown>) => ClientePg } {
  try {
    requirePg ??= createRequire(resolve(dirname(fileURLToPath(import.meta.url)), '../../../../workers/comprobantes-pdf/package.json'))
    return requirePg('pg')
  } catch (e) {
    throw new Error(`E2E sql(): no se encontró «pg» en workers/comprobantes-pdf (¿corriste pnpm install?): ${(e as Error).message}`)
  }
}

/**
 * Siembra por SQL directo (Postgres local) para las tablas de `public` a las que `service_role` NO tiene grant
 * (`conexiones`, `features`, `avisos_pendientes`...): la API REST las rechaza con 42501 y dar el grant exigiría una migración.
 * ATENCIÓN: corre como superusuario `postgres`, así que SALTA grants y RLS. Sirve solo para SEMBRAR; nunca para VERIFICAR
 * (una lectura aquí no prueba lo que ve un rol real) ni para tablas protegidas de solo lectura. El destino lo valida
 * `validarDestinoSql`.
 */
export async function sql<T = Record<string, unknown>>(consulta: string, valores: unknown[] = []): Promise<T[]> {
  const destino = validarDestinoSql(process.env)
  const { Client } = cargarPg()
  // Con tope de conexión y de consulta: sin él, un Postgres que no responde (puente caído, bloqueo) deja el test colgado hasta
  // su timeout de 5 min en vez de fallar con un mensaje.
  const cliente = new Client({ ...destino, connectionTimeoutMillis: 20_000, query_timeout: 60_000, statement_timeout: 60_000 })
  try {
    await cliente.connect()
    return (await cliente.query(consulta, valores)).rows as T[]
  } finally {
    await cliente.end().catch(() => {})
  }
}
