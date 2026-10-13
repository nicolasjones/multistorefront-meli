// Lógica de `invitar-miembro` con dependencias inyectadas para poder probarla sin Deno ni Supabase
// (handler.test.ts). `index.ts` solo cablea los clientes reales.

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const ROLES = ['administrador', 'operador', 'consulta', 'mostrador', 'deposito', 'administracion']

type DbError = { message: string; code?: string }
type Resultado<T = unknown> = Promise<{ data: T; error: DbError | null }>
type Cuenta = { id: string; email?: string | null; last_sign_in_at?: string | null; email_confirmed_at?: string | null; invited_at?: string | null }
export type Invitacion = { id: string; created_at: string; updated_at: string; auth_user_id: string | null }

export type Deps = {
  appUrl: string
  admin: {
    auth: {
      getUser(jwt: string): Resultado<{ user: { id: string } | null }>
      admin: {
        listUsers(params: { page: number; perPage: number }): Resultado<{ users: Cuenta[] }>
        deleteUser(id: string): Resultado<unknown>
        inviteUserByEmail(email: string, options: { redirectTo: string }): Resultado<{ user: { id: string } | null }>
      }
    }
    // deno-lint-ignore no-explicit-any
    from(tabla: string): any
  }
  // deno-lint-ignore no-explicit-any
  caller(jwt: string): { rpc(nombre: string, args: Record<string, unknown>): Resultado<any> }
}

// Mensajes controlados por código: el texto de Postgres no sale al cliente. Solo rol/correo
// inválido tienen mensaje propio; el resto de 22023 (cuenta ajena o que no ingresó) responde
// genérico para no revelar si el correo tiene cuenta.
const rpcError = (error: DbError) => {
  if (error.code === '42501') return response({ error: 'No tienes permiso para gestionar usuarios de esta organización.' }, 403)
  if (error.code === '23505') return response({ error: 'No se puede invitar a ese correo.' }, 409)
  if (error.code === '22023' && (error.message === 'Rol inválido' || error.message === 'Correo inválido')) return response({ error: error.message }, 400)
  if (error.code === '22023') return response({ error: 'No se puede invitar a ese correo.' }, 409)
  if (error.code === 'P0002') return response({ error: 'La invitación no existe o ya no está pendiente.' }, 404)
  return response({ error: 'No se pudo completar la operación.' }, 400)
}

export async function manejar(req: Request, { appUrl, admin, caller }: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return response({ error: 'Método no soportado.' }, 405)
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return response({ error: 'Falta autenticación.' }, 403)
  const { data: callerData, error: callerError } = await admin.auth.getUser(jwt)
  if (callerError || !callerData.user) return response({ error: 'Token inválido o expirado.' }, 403)
  const rpc = caller(jwt)
  const body = await req.json().catch(() => null) as { accion?: string; email?: string; rol?: string; invitacion_id?: string } | null

  // Cancelar: el RPC verifica el rol del llamador, registra el evento y devuelve la cuenta de Auth
  // sin uso a borrar, que es lo que hace que el enlace deje de servir.
  if (body?.accion === 'cancelar') {
    if (!body.invitacion_id) return response({ error: 'Falta la invitación.' }, 400)
    const { data: borrar, error } = await rpc.rpc('cancelar_invitacion', { p_invitacion_id: body.invitacion_id })
    if (error) return rpcError(error)
    if (borrar) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(borrar as string)
      if (deleteError) {
        console.error('invitar-miembro: no se pudo borrar la cuenta de la invitación cancelada', deleteError.message)
        return response({ error: 'La invitación se canceló, pero no pudimos invalidar el enlace ya enviado. Ese enlace no da acceso a la organización.' }, 502)
      }
    }
    return response({ resultado: 'invitacion_cancelada' })
  }

  // Invitar y reenviar son la misma operación: el RPC crea o renueva la invitación pendiente
  // (7 días) tras verificar rol de gestión, rol destino y organización única.
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : undefined
  const rol = body?.rol
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !ROLES.includes(rol ?? '')) return response({ error: 'Email o rol inválido.' }, 400)
  // Puerta previa: solo quien puede gestionar usuarios llega a resolver la cuenta (service-role). Así un
  // no-administrador recibe la misma respuesta con un correo libre que con uno existente (FR-009) y no
  // dispara el barrido de Auth.
  const { data: organizacionId, error: permisoError } = await rpc.rpc('puede_invitar', {})
  if (permisoError) return rpcError(permisoError)
  let existing: Cuenta | undefined
  for (let page = 1; !existing; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) return response({ error: 'No se pudo resolver la cuenta.' }, 502)
    existing = data.users.find((user) => user.email?.toLowerCase() === email)
    if (data.users.length < 1000) break
  }
  // Cuenta sin uso creada por una invitación (invited_at): es la única que se puede reemplazar. Una
  // auto-registración pendiente de confirmar (sin invited_at) es de la persona y no se borra.
  const sinUso = (cuenta: Cuenta) => Boolean(cuenta.invited_at) && !cuenta.last_sign_in_at && !cuenta.email_confirmed_at
  // Cuenta que no se puede reemplazar y que no pertenece a ninguna invitación pendiente: se rechaza
  // ANTES de registrar, para que el RPC no renueve el rol ni el vencimiento de una invitación
  // pendiente cuyo resultado final sería un 409.
  if (existing && !sinUso(existing)) {
    const { data: vinculadas, error: vinculadasError } = await admin.from('invitaciones_organizacion')
      .select('id').eq('auth_user_id', existing.id).eq('estado', 'pendiente').eq('organizacion_id', organizacionId)
    if (vinculadasError || (vinculadas ?? []).length === 0) return response({ error: 'No se puede invitar a ese correo.' }, 409)
  }
  const { data: invitacion, error: registrarError } = await rpc.rpc('registrar_invitacion', { p_email: email, p_rol_id: rol })
  if (registrarError) return rpcError(registrarError)
  const reg = invitacion as Invitacion
  const nueva = reg.updated_at === reg.created_at

  // La invitación ya está persistida: si algo falla antes de vincularla se compensa para no dejar
  // una «pendiente» que nunca se envió. Una nueva se elimina; una renovada solo suelta la cuenta
  // de Auth que ya se borró (conserva su historial y se puede reenviar).
  const deshacer = async (soltarCuenta: boolean) => {
    const tabla = admin.from('invitaciones_organizacion')
    const { error } = nueva
      ? await tabla.delete().eq('id', reg.id)
      : soltarCuenta ? await tabla.update({ auth_user_id: null }).eq('id', reg.id) : { error: null }
    if (error) console.error('invitar-miembro: no se pudo compensar la invitación', reg.id, error.message)
  }

  let cuentaSoltada = false
  // La cuenta que creó ESTA invitación se reemplaza siempre, aunque ya haya abierto el enlace: sin
  // organización ni contraseña definida solo sirve para aceptar la invitación, y reenviar debe emitir
  // un enlace nuevo en vez de agregarla sin que acepte. Además se reemplazan las cuentas de invitación
  // que nunca confirmaron el correo (p. ej. huérfana de una cancelación cuyo borrado falló); una
  // cuenta confirmada o de auto-registro ajena a la invitación no se borra.
  const propia = Boolean(existing && reg.auth_user_id === existing.id)
  if (existing && (propia || sinUso(existing))) {
    // Si otra invitación pendiente usa una cuenta que no es de esta invitación puede ser de otra
    // organización: no se toca.
    if (!propia) {
      const { data: ajenas, error: ajenasError } = await admin.from('invitaciones_organizacion')
        .select('id').eq('auth_user_id', existing.id).eq('estado', 'pendiente').neq('id', reg.id)
      if (ajenasError || (ajenas ?? []).length > 0) { await deshacer(false); return response({ error: 'No se puede invitar a ese correo.' }, 409) }
    }
    const { error } = await admin.auth.admin.deleteUser(existing.id)
    if (error) { await deshacer(false); return response({ error: 'No se pudo renovar la invitación.' }, 502) }
    existing = undefined
    cuentaSoltada = true
  }
  const accion = nueva && !cuentaSoltada ? 'invitacion_enviada' : 'invitacion_reenviada'
  let usuarioInvitadoId: string | undefined
  let userId = existing?.id
  if (!userId) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${appUrl}/acceso/definir-contrasena?origen=invitacion`,
    })
    if (error || !data.user) { await deshacer(cuentaSoltada); return response({ error: `No se pudo invitar a ${email}.` }, 502) }
    userId = data.user.id
    usuarioInvitadoId = data.user.id
  } else {
    // Cuenta confirmada y ajena a esta invitación (haya ingresado o no): no se agrega directo —la
    // persona debe aceptar— ni se borra. Responde igual que cualquier otra cuenta no invitable, sin
    // revelar el estado de la cuenta.
    await deshacer(false)
    return response({ error: 'No se puede invitar a ese correo.' }, 409)
  }
  const { data, error } = await rpc.rpc('vincular_invitacion', { p_invitacion_id: reg.id, p_user_id: userId, p_accion: accion })
  if (error) {
    if (usuarioInvitadoId) {
      const { error: borradoError } = await admin.auth.admin.deleteUser(usuarioInvitadoId)
      if (borradoError) console.error('invitar-miembro: cuenta huérfana tras vincular_invitacion', usuarioInvitadoId, borradoError.message)
    }
    await deshacer(Boolean(usuarioInvitadoId))
    return rpcError(error)
  }
  return response({ ...data, resultado: accion }, 201)
}
