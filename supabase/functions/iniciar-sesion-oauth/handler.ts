// Contrato: specs/20260930-153545-conexiones-oauth-nango/contracts/conectar-oauth.md
//
// El SDK de frontend de Nango (0.71.x) ya no acepta host+publicKey a secas
// para self-host: exige un "Connect Session Token" de corta duración,
// generado server-to-server con NANGO_SECRET_KEY_* (nunca expuesto al
// navegador). Esta función es ese único punto de generación — mismo patrón
// que emitir-acceso-reporte (spec 007): arma un cliente autenticado como el
// propio usuario (nunca la service-role) y deja que RLS de conexiones_oauth
// decida si hay algo que devolver.
//
// La lógica vive acá y no importa nada de Deno ni de Supabase para poder probarla con
// `node --test` (handler.test.ts, `pnpm test:edge:iniciar-sesion-oauth`); index.ts cablea los
// clientes reales.

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export type ConexionOauth = {
  organizacion_id: string
  nango_connection_id: string | null
  integraciones_oauth: unknown
}

export type Deps = {
  /** Valida el JWT con la service-role (solo para eso). */
  validarJwt: (jwt: string) => Promise<boolean>
  /**
   * Lee la conexión COMO el usuario que llama (nunca la service-role): si RLS de
   * `conexiones_oauth` no deja ver la fila devuelve null. El error de la consulta no se
   * distingue de «sin fila».
   */
  leerConexion: (jwt: string, conexionId: string) => Promise<ConexionOauth | null>
  /** NANGO_URL y NANGO_SECRET_KEY: se leen recién cuando hay algo que pedirle a Nango. */
  config: () => { nangoUrl: string; nangoSecretKey: string }
  fetch: typeof fetch
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export async function manejar(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Método no soportado, usar POST.' }, 400)
  }

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) {
    return jsonResponse({ error: 'No autorizado' }, 403)
  }

  if (!(await deps.validarJwt(jwt))) {
    return jsonResponse({ error: 'No autorizado' }, 403)
  }

  let body: { conexion_id?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Cuerpo inválido: se esperaba JSON.' }, 400)
  }

  const conexionId = body.conexion_id
  if (!conexionId) {
    return jsonResponse({ error: 'Falta "conexion_id".' }, 400)
  }

  // Cliente autenticado como el propio usuario — nunca la service-role: si
  // RLS de conexiones_oauth no deja ver la fila (no es admin de esa
  // organización ni superadmin), acá no hay nada que devolver.
  const conexion = await deps.leerConexion(jwt, conexionId)

  if (!conexion) {
    return jsonResponse({ error: 'No autorizado' }, 403)
  }

  const clave = (conexion.integraciones_oauth as unknown as { clave: string } | null)?.clave
  if (!clave) {
    return jsonResponse({ error: 'No autorizado' }, 403)
  }

  // NANGO_URL es server-to-server (esta función corre en el contenedor de
  // Edge Functions — en local, host.docker.internal; en producción, la URL
  // pública del Nango de ese entorno, la misma que ve el navegador). Mismo
  // motivo que SUPERSET_URL/SUPERSET_PUBLIC_URL en emitir-acceso-reporte.
  const { nangoUrl, nangoSecretKey } = deps.config()
  const timeout = () => AbortSignal.timeout(10_000)

  // Nango asigna el connection_id — no se puede fijar en POST /connect/sessions
  // (research.md R8). Primera vez: sesión de creación normal. Reautorizar una
  // conexión que ya tiene nango_connection_id: sesión de /reconnect, que
  // apunta a ese mismo connection_id existente en vez de crear uno nuevo.
  const esReconexion = Boolean(conexion.nango_connection_id)
  const endpoint = esReconexion ? '/connect/sessions/reconnect' : '/connect/sessions'
  const payload = esReconexion
    ? { connection_id: conexion.nango_connection_id, integration_id: clave }
    : { end_user: { id: conexion.organizacion_id }, allowed_integrations: [clave] }

  try {
    const sesionRes = await deps.fetch(`${nangoUrl}${endpoint}`, {
      method: 'POST',
      signal: timeout(),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${nangoSecretKey}`,
      },
      body: JSON.stringify(payload),
    })

    if (!sesionRes.ok) {
      return jsonResponse({ error: 'conexion_oauth_no_disponible' }, 503)
    }

    const { data } = await sesionRes.json()

    return jsonResponse({ token: data.token, es_reconexion: esReconexion }, 200)
  } catch {
    // Nango caído, timeout, o cualquier fallo de red — mismo criterio que
    // emitir-acceso-reporte: mensaje puntual, sin reintento automático.
    return jsonResponse({ error: 'conexion_oauth_no_disponible' }, 503)
  }
}
