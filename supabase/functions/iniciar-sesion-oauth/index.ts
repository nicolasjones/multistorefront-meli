// Contrato: specs/20260930-153545-conexiones-oauth-nango/contracts/conectar-oauth.md
//
// El SDK de frontend de Nango (0.71.x) ya no acepta host+publicKey a secas
// para self-host: exige un "Connect Session Token" de corta duración,
// generado server-to-server con NANGO_SECRET_KEY_* (nunca expuesto al
// navegador). Esta función es ese único punto de generación — mismo patrón
// que emitir-acceso-reporte (spec 007): arma un cliente autenticado como el
// propio usuario (nunca la service-role) y deja que RLS de conexiones_oauth
// decida si hay algo que devolver.
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Método no soportado, usar POST.' }, 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const admin = createClient(supabaseUrl, serviceRoleKey)

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) {
    return jsonResponse({ error: 'No autorizado' }, 403)
  }

  const { data: callerData, error: callerError } = await admin.auth.getUser(jwt)
  if (callerError || !callerData?.user) {
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
  const asUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })

  const { data: conexion } = await asUser
    .from('conexiones_oauth')
    .select('organizacion_id, nango_connection_id, integraciones_oauth(clave)')
    .eq('id', conexionId)
    .maybeSingle()

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
  const nangoUrl = Deno.env.get('NANGO_URL')!
  const nangoSecretKey = Deno.env.get('NANGO_SECRET_KEY')!
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
    const sesionRes = await fetch(`${nangoUrl}${endpoint}`, {
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
})
