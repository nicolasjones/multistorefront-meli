import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
// Puerto por defecto alineado a WEB_PORT (spec 015, contracts/variables-puerto.md)
// — igual que SUPERSET_PUBLIC_URL en este mismo .env.example, se actualiza a
// mano acá si se cambia WEB_PORT (esta función no puede leer variables de
// entorno del Refine que la invoca, solo las propias del contenedor de Edge
// Functions).
const appUrl = (Deno.env.get('APP_URL') ?? 'http://127.0.0.1:3100').replace(/\/$/, '')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return response({ error: 'Método no soportado.' }, 405)
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return response({ error: 'Falta autenticación.' }, 403)
  const url = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
  const { data: callerData, error: callerError } = await admin.auth.getUser(jwt)
  if (callerError || !callerData.user) return response({ error: 'Token inválido o expirado.' }, 403)
  const body = await req.json().catch(() => null) as { email?: string; rol?: string } | null
  const email = body?.email?.trim().toLowerCase(); const rol = body?.rol
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !['administrador', 'miembro'].includes(rol ?? '')) return response({ error: 'Email o rol inválido.' }, 400)
  let existing: { id: string } | undefined
  for (let page = 1; !existing; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) return response({ error: 'No se pudo resolver la cuenta.' }, 502)
    existing = data.users.find((user) => user.email?.toLowerCase() === email)
    if (data.users.length < 1000) break
  }
  let userId = existing?.id; let usuarioInvitadoId: string | undefined; let accion = 'miembro_agregado'
  if (!userId) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${appUrl}/acceso/definir-contrasena?origen=invitacion`,
    })
    if (error || !data.user) return response({ error: `No se pudo invitar a ${email}.` }, 502)
    userId = data.user.id; usuarioInvitadoId = data.user.id; accion = 'invitacion_enviada'
  }
  const { data, error } = await caller.rpc('agregar_miembro', { p_target_user_id: userId, p_rol_id: rol, p_accion: accion })
  if (error) {
    if (usuarioInvitadoId) await admin.auth.admin.deleteUser(usuarioInvitadoId)
    return response({ error: error.message }, error.code === '42501' ? 403 : 400)
  }
  return response({ ...data, resultado: accion }, 201)
})
