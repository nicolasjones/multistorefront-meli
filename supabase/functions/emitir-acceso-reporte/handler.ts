// Contrato: specs/007-analitica-embebida/contracts/acceso-reporte.md (+ restricción por sección,
// specs/20261023-170000-rentabilidad-margen, FR-007; + filtro por empresa, MSF-347 F-VTA-22 FR-004).
//
// Emite un guest token de Superset con la organización de quien llama forzada en la cláusula `rls`
// (FR-010) y, desde F-VTA-22, también con las empresas accesibles de quien llama. La autorización NO
// se reescribe acá: `resolver_organizacion_reporte` decide (reglas de la spec 007 + sección de
// permisos del reporte, si la declara) y devuelve null si no hay acceso → 403 sin emitir token. Esta
// lógica no importa nada de Deno ni de Supabase para poder probarla con `node --test`
// (handler.test.ts); index.ts cablea los clientes reales.

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export type Deps = {
  /** Valida el JWT (service-role solo para eso, nunca para leer datos de negocio). */
  validarJwt: (jwt: string) => Promise<boolean>
  /** RPC `resolver_organizacion_reporte` ejecutada COMO el usuario que llama. */
  resolverOrganizacion: (jwt: string, reporteId: string) => Promise<string | null>
  /**
   * Empresas accesibles del usuario (FR-004): las resuelve la RPC `public.empresas_para_selector()`
   * (que expone `private.empresas_accesibles()`) ejecutada COMO el usuario que llama — las mismas
   * empresas que ofrece el selector de la barra superior.
   */
  empresasAccesibles: (jwt: string) => Promise<string[]>
  /**
   * Fila del reporte, leída COMO el usuario (RLS de `reportes`): el UUID del dashboard de Superset y
   * si su tablero filtra por empresa (`reportes.filtro_empresa`, F-VTA-22).
   *
   * Si la lectura falla (por ejemplo, la columna `filtro_empresa` no existe todavía en el
   * entorno), la dependencia LANZA el error: el handler lo traduce a 503 `analitica_no_disponible`
   * (fallo del servicio), no a 403 «No autorizado» (que parecería falta de permisos).
   */
  reporte: (jwt: string, reporteId: string) => Promise<{ dashboardUuid: string; filtroEmpresa: boolean } | null>
  config: {
    supersetUrl: string
    supersetPublicUrl: string
    username: string
    password: string
  }
  fetch: typeof fetch
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Cláusula `rls` del guest token (FR-004): la organización (la que resolvió la RPC, nunca una que
 * mande el cliente) y, si el tablero filtra por empresa, las empresas accesibles del usuario.
 *
 * Los identificadores se validan uno por uno: lo que no es UUID se descarta, porque no puede
 * identificar una empresa y la lista se interpola como texto SQL (nunca texto libre del cliente).
 * Sin empresas accesibles la cláusula no deja pasar filas (`false`): es un filtro de datos, no una
 * decisión de autorización —la autorización ya la tomó `resolver_organizacion_reporte`— y un token sin
 * ese filtro dejaría ver filas de empresas ajenas.
 *
 * `empresas` en `null` = el tablero NO filtra por empresa: la cláusula queda solo con la
 * organización. La cláusula del guest token se aplica a TODOS los datasets del tablero, así que un
 * tablero cuyas vistas no tienen `empresa_id` (los consolidados por organización) no pueden llevarla
 * (`public.reportes.filtro_empresa`).
 */
export function clausulaRls(
  organizacionId: string,
  empresas: readonly string[] | null = null,
): string | null {
  if (!UUID.test(organizacionId)) return null
  if (empresas === null) return `organizacion_id = '${organizacionId}'`
  const validas = [...new Set(empresas.filter((empresa) => UUID.test(empresa)))]
  const porEmpresa =
    validas.length > 0 ? `empresa_id IN (${validas.map((empresa) => `'${empresa}'`).join(', ')})` : 'false'
  return `organizacion_id = '${organizacionId}' AND ${porEmpresa}`
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

  // La fila del reporte se lee COMO el usuario (RLS de `reportes`). Si la lectura falla (por ejemplo,
  // la columna `filtro_empresa` todavía no existe en el entorno porque la migración
  // 20270104090050 no corrió), es un fallo del servicio y NO una decisión de autorización: se
  // responde 503 para que quede diagnosticable. Antes el error se silenciaba y TODOS los
  // tableros —incluidos los de Rentabilidad, que sí funcionaban— respondían 403 «No autorizado».
  let reporte: { dashboardUuid: string; filtroEmpresa: boolean } | null
  try {
    reporte = await deps.reporte(jwt, reporteId)
  } catch {
    return jsonResponse({ error: 'analitica_no_disponible' }, 503)
  }
  if (!reporte?.dashboardUuid) {
    return jsonResponse({ error: 'No autorizado' }, 403)
  }
  const { dashboardUuid, filtroEmpresa } = reporte

  // Las empresas accesibles acotan el token a las tiendas que el usuario puede ver (FR-004), pero
  // solo para los tableros que lo declaran (`reportes.filtro_empresa`): la cláusula `rls` se aplica
  // a TODOS los datasets del tablero y un tablero por organización no tiene `empresa_id` en sus
  // vistas. Si no se pueden resolver, NO se emite token: emitirlo sin ese filtro dejaría ver filas
  // de empresas ajenas (fallar abierto). Es un fallo del servicio, no una decisión de autorización.
  let clause: string | null
  if (filtroEmpresa) {
    let empresas: string[]
    try {
      empresas = await deps.empresasAccesibles(jwt)
    } catch {
      return jsonResponse({ error: 'alcance_no_resuelto' }, 503)
    }
    clause = clausulaRls(organizacionId, empresas)
  } else {
    clause = clausulaRls(organizacionId)
  }
  if (!clause) {
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
        rls: [{ clause }],
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
