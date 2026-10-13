import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const ROLES = ['administrador', 'operador', 'consulta', 'mostrador', 'deposito', 'administracion']
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
  const body = await req.json().catch(() => null) as { accion?: string; email?: string; rol?: string; invitacion_id?: string } | null
  const rpcError = (error: { message: string; code?: string }) =>
    response({ error: error.message }, error.code === '42501' ? 403 : error.code === '23505' ? 409 : 400)

  // Cancelar: el RPC verifica el rol del llamador y devuelve la cuenta de Auth sin uso
  // a borrar, que es lo que hace que el enlace deje de servir.
  if (body?.accion === 'cancelar') {
    if (!body.invitacion_id) return response({ error: 'Falta la invitación.' }, 400)
    const { data: borrar, error } = await caller.rpc('cancelar_invitacion', { p_invitacion_id: body.invitacion_id })
    if (error) return rpcError(error)
    if (borrar) await admin.auth.admin.deleteUser(borrar as string)
    return response({ resultado: 'invitacion_cancelada' })
  }

  // Invitar y reenviar son la misma operación: el RPC crea o renueva la invitación
  // pendiente (7 días) tras verificar rol de gestión, rol destino y organización única.
  const email = body?.email?.trim().toLowerCase(); const rol = body?.rol
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !ROLES.includes(rol ?? '')) return response({ error: 'Email o rol inválido.' }, 400)
  const { data: invitacion, error: registrarError } = await caller.rpc('registrar_invitacion', { p_email: email, p_rol_id: rol })
  if (registrarError) return rpcError(registrarError)

  let existing: { id: string; last_sign_in_at?: string | null } | undefined
  for (let page = 1; !existing; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) return response({ error: 'No se pudo resolver la cuenta.' }, 502)
    existing = data.users.find((user) => user.email?.toLowerCase() === email)
    if (data.users.length < 1000) break
  }
  let userId = existing?.id; let usuarioInvitadoId: string | undefined
  let accion = invitacion.updated_at !== invitacion.created_at ? 'invitacion_reenviada' : 'invitacion_enviada'
  if (existing && !existing.last_sign_in_at) {
    // Cuenta de una invitación anterior que nunca ingresó: se reemplaza para emitir un enlace nuevo.
    await admin.auth.admin.deleteUser(existing.id)
    existing = undefined; userId = undefined; accion = 'invitacion_reenviada'
  }
  if (!userId) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${appUrl}/acceso/definir-contrasena?origen=invitacion`,
    })
    if (error || !data.user) return response({ error: `No se pudo invitar a ${email}.` }, 502)
    userId = data.user.id; usuarioInvitadoId = data.user.id
  } else {
    // Cuenta existente que ya ingresó y no pertenece a ninguna organización: se agrega directo.
    accion = 'miembro_agregado'
  }
  const { data, error } = await caller.rpc('vincular_invitacion', { p_invitacion_id: invitacion.id, p_user_id: userId, p_accion: accion })
  if (error) {
    if (usuarioInvitadoId) await admin.auth.admin.deleteUser(usuarioInvitadoId)
    return rpcError(error)
  }
  return response({ ...data, resultado: accion }, 201)
})
