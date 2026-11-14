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
  reporte: (jwt: string, reporteId: string) => Promise<{
    dashboardUuid: string
    filtroEmpresa: boolean
    /**
     * Allowlist: nombres de dataset (`table_name`) del tablero (`reportes.datasets_permitidos`). El token queda
     * vedado para TODO otro dataset de Superset. Vacía o ausente = no se emite token (falla cerrado).
     */
    datasetsPermitidos?: readonly string[]
  } | null>
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

const POR_PAGINA = 100
const MAX_PAGINAS = 100

/** Todos los datasets de Superset (`id`, `table_name`), paginados. `null` si no se pueden listar. */
export async function listarDatasets(superset: {
  url: string
  accessToken: string
  fetch: typeof fetch
  signal: () => AbortSignal
}): Promise<{ id: number; table_name: string }[] | null> {
  const porId = new Map<number, { id: number; table_name: string }>()
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const q = `(columns:!(id,table_name),order_column:table_name,order_direction:asc,page:${pagina},page_size:${POR_PAGINA})`
    const res = await superset.fetch(`${superset.url}/api/v1/dataset/?q=${encodeURIComponent(q)}`, {
      signal: superset.signal(),
      headers: { Authorization: `Bearer ${superset.accessToken}` },
    })
    if (!res.ok) return null
    const { result, count } = (await res.json()) as { result?: { id?: unknown; table_name?: unknown }[]; count?: unknown }
    if (!Array.isArray(result) || typeof count !== 'number') return null
    for (const fila of result) {
      if (!Number.isInteger(fila.id) || typeof fila.table_name !== 'string') return null
      porId.set(fila.id as number, { id: fila.id as number, table_name: fila.table_name })
    }
    // Completo cuando se recibieron tantos ids distintos como declara el total; una página vacía antes de eso es un
    // listado inconsistente (no se emite token).
    if (porId.size >= count) return [...porId.values()]
    if (result.length === 0) return null
  }
  return null
}

/**
 * El rol Guest de Superset es uno solo y tiene `datasource_access` sobre TODOS los datasets embebidos: el token de
 * un tablero podría pedir por la API el dataset de otro (el de costos, o los de Rentabilidad con margen). Allowlist:
 * se lista todo dataset de Superset y para cada uno que NO esté entre los del tablero (`permitidos`, por nombre) se
 * agrega una regla `rls` por dataset (`1 = 0`). Un nombre repetido (dataset duplicado) permite todos sus ids.
 * Devuelve `null` —el handler NO emite token (falla cerrado)— si la allowlist está vacía, si no se puede listar o si
 * ningún dataset de Superset coincide con un nombre permitido (el tablero no está importado).
 */
export async function reglasDatasetsAjenos(
  permitidos: readonly string[],
  superset: { url: string; accessToken: string; fetch: typeof fetch; signal: () => AbortSignal },
): Promise<{ dataset: number; clause: string }[] | null> {
  if (permitidos.length === 0) return null
  const todos = await listarDatasets(superset)
  if (!todos) return null
  const propios = new Set(permitidos)
  const encontrados = new Set(todos.filter((d) => propios.has(d.table_name)).map((d) => d.table_name))
  // Cada nombre de la allowlist debe existir: si falta uno, el tablero no podría leerlo y no se sabe qué se vedó.
  if (permitidos.some((nombre) => !encontrados.has(nombre))) return null
  return todos.filter((d) => !propios.has(d.table_name)).map((d) => ({ dataset: d.id, clause: '1 = 0' }))
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
  // 20270116110200 no corrió), es un fallo del servicio y NO una decisión de autorización: se
  // responde 503 para que quede diagnosticable. Antes el error se silenciaba y TODOS los
  // tableros —incluidos los de Rentabilidad, que sí funcionaban— respondían 403 «No autorizado».
  let reporte: Awaited<ReturnType<Deps['reporte']>>
  try {
    reporte = await deps.reporte(jwt, reporteId)
  } catch {
    return jsonResponse({ error: 'analitica_no_disponible' }, 503)
  }
  if (!reporte?.dashboardUuid) {
    return jsonResponse({ error: 'No autorizado' }, 403)
  }
  const { dashboardUuid, filtroEmpresa, datasetsPermitidos = [] } = reporte

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

    const vedados = await reglasDatasetsAjenos(datasetsPermitidos, {
      url: supersetUrl,
      accessToken,
      fetch: deps.fetch,
      signal: timeout,
    })
    if (!vedados) {
      // Sin allowlist o sin poder listar/resolver los datasets: emitir el token sin las reglas dejaría leer los de otros tableros.
      return jsonResponse({ error: 'analitica_no_disponible' }, 503)
    }

    const guestTokenRes = await deps.fetch(`${supersetUrl}/api/v1/security/guest_token/`, {
      method: 'POST',
      signal: timeout(),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        resources: [{ type: 'dashboard', id: dashboardUuid }],
        rls: [{ clause }, ...vedados],
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
