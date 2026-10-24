// Contrato: specs/007-analitica-embebida/contracts/acceso-reporte.md (+ restricción por sección,
// specs/20261023-170000-rentabilidad-margen, FR-007).
//
// Emite un guest token de Superset con la organización de quien llama forzada en la cláusula `rls`
// (FR-010). La autorización NO se reescribe acá: `resolver_organizacion_reporte` decide (reglas de la
// spec 007 + sección de permisos del reporte, si la declara) y devuelve null si no hay acceso → 403
// sin emitir token. Esta lógica no importa nada de Deno ni de Supabase para poder probarla con
// `node --test` (handler.test.ts); index.ts cablea los clientes reales.

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export type Deps = {
  /** Valida el JWT (service-role solo para eso, nunca para leer datos de negocio). */
  validarJwt: (jwt: string) => Promise<boolean>
  /** RPC `resolver_organizacion_reporte` ejecutada COMO el usuario que llama. */
  resolverOrganizacion: (jwt: string, reporteId: string) => Promise<string | null>
  /** UUID del dashboard de Superset, leído COMO el usuario (RLS de `reportes`). */
  dashboardUuid: (jwt: string, reporteId: string) => Promise<string | null>
  config: {
    supersetUrl: string
    supersetPublicUrl: string
    username: string
    password: string
  }
  fetch: typeof fetch
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  if (!jwt || !(await deps.validarJwt(jwt))) {
    return jsonResponse({ error: 'No autorizado' }, 403)
  }

  let body: { reporte_id?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Cuerpo inválido: se esperaba JSON.' }, 400)
  }
  const reporteId = body.reporte_id
  if (!reporteId) {
    return jsonResponse({ error: 'Falta "reporte_id".' }, 400)
  }

  // La organización la resuelve la RPC (respeta la organización activa del superadmin y, para los
  // reportes con `seccion`, exige lectura o edición en ella). Ni siquiera se revela si el reporte
  // existe (FR-007): sin organización → 403 y no se pide nada a Superset.
  const organizacionId = await deps.resolverOrganizacion(jwt, reporteId)
  // Se interpola en la cláusula `rls`: debe ser un UUID, nunca texto libre.
  if (!organizacionId || !UUID.test(organizacionId)) {
    return jsonResponse({ error: 'No autorizado' }, 403)
  }

  const dashboardUuid = await deps.dashboardUuid(jwt, reporteId)
  if (!dashboardUuid) {
    return jsonResponse({ error: 'No autorizado' }, 403)
  }

  const { supersetUrl, supersetPublicUrl, username, password } = deps.config
  // Sin timeout, si SUPERSET_URL no resuelve el isolate cuelga hasta el wall-clock en vez de caer en
  // el 503 del catch (docs/operar-superset.md).
  const timeout = () => AbortSignal.timeout(10_000)

  try {
    const loginRes = await deps.fetch(`${supersetUrl}/api/v1/security/login`, {
      method: 'POST',
      signal: timeout(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, provider: 'db', refresh: false }),
    })
    if (!loginRes.ok) {
      return jsonResponse({ error: 'analitica_no_disponible' }, 503)
    }
    const { access_token: accessToken } = await loginRes.json()

    const guestTokenRes = await deps.fetch(`${supersetUrl}/api/v1/security/guest_token/`, {
      method: 'POST',
      signal: timeout(),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        resources: [{ type: 'dashboard', id: dashboardUuid }],
        rls: [{ clause: `organizacion_id = '${organizacionId}'` }],
        user: { username: 'guest' },
      }),
    })
    if (!guestTokenRes.ok) {
      return jsonResponse({ error: 'analitica_no_disponible' }, 503)
    }
    const { token: guestToken } = await guestTokenRes.json()

    return jsonResponse(
      { guest_token: guestToken, superset_url: supersetPublicUrl, dashboard_uuid: dashboardUuid },
      200,
    )
  } catch {
    // Superset caído, timeout o cualquier fallo de red — FR-015: mensaje puntual, sin reintento.
    return jsonResponse({ error: 'analitica_no_disponible' }, 503)
  }
}
