// Lógica de `invitar-cliente` (F-CLI-05, FR-003/004/009/018) con dependencias inyectadas para poder probarla sin
// Deno ni Supabase (handler.test.ts). `index.ts` solo cablea los clientes reales.
//
// A diferencia de `invitar-miembro`, la cuenta web NO es miembro del panel: esta función nunca escribe
// `usuarios_organizacion` (ni siquiera recibe un acceso a tablas: `admin` solo expone Auth y RPC).

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type DbError = { message: string; code?: string }
type Resultado<T = unknown> = Promise<{ data: T; error: DbError | null }>
type Preparacion = { correo: string; dominio: string; auth_user_id: string | null }
type CuentaWeb = { empresa_id: string; estado: string }

export type Deps = {
  // `http` solo en desarrollo local; en cualquier otro entorno las tiendas viven en https.
  protocolo: 'https' | 'http'
  admin: {
    auth: {
      getUser(jwt: string): Resultado<{ user: { id: string } | null }>
      admin: {
        createUser(options: { email: string; email_confirm: boolean }): Resultado<{ user: { id: string } | null }>
        deleteUser(id: string): Resultado<unknown>
        getUserById(id: string): Resultado<{ user: { email?: string | null } | null }>
      }
    }
    // Solo `vincular_cuenta_cliente` (restringida a service_role).
    rpc(nombre: string, args: Record<string, unknown>): Resultado<unknown>
  }
  // Envía el correo de Auth para definir una nueva clave (plantilla de recuperación) con redirección a la tienda.
  enviarClave(email: string, redirectTo: string): Resultado<unknown>
  // RPC con el JWT del operador: los permisos se validan en la base.
  caller(jwt: string): { rpc(nombre: string, args: Record<string, unknown>): Resultado<unknown> }
}

// Mensaje único para correo de usuario del panel (D5), cliente de otra organización y tienda no habilitada:
// no revela cuál de las tres ocurrió (FR-018).
const NO_SE_PUEDE = 'No se puede crear la cuenta web con esos datos.'

// Mensajes controlados por código: el texto de Postgres no sale al cliente.
const rpcError = (error: DbError) => {
  if (error.code === '42501') return response({ error: 'No tienes permiso para gestionar cuentas web de esta tienda.' }, 403)
  if (error.code === '22023' && error.message === 'El cliente no tiene correo') return response({ error: 'Carga un correo para crear la cuenta.' }, 400)
  if (error.code === '22023' && error.message === 'La tienda no tiene dominio') return response({ error: 'La tienda todavía no tiene un dominio configurado.' }, 400)
  if (error.code === '22023' || error.code === 'P0002') return response({ error: NO_SE_PUEDE }, 409)
  return response({ error: 'No se pudo completar la operación.' }, 400)
}

export async function manejar(req: Request, { protocolo, admin, enviarClave, caller }: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return response({ error: 'Método no soportado.' }, 405)
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return response({ error: 'Falta autenticación.' }, 403)
  const { data: callerData, error: callerError } = await admin.auth.getUser(jwt)
  if (callerError || !callerData.user) return response({ error: 'Token inválido o expirado.' }, 403)
  const operador = callerData.user.id

  const body = await req.json().catch(() => null) as { cliente_id?: string; empresa_id?: string; accion?: string; invitar?: boolean } | null
  const accion = body?.accion ?? 'crear'
  // La casilla «Enviar invitación por correo al crear la cuenta» del formulario:
  // sin invitación la cuenta queda activa y el enlace se manda luego con «Restablecer clave».
  const invitar = body?.invitar !== false
  if (!body || !UUID.test(body.cliente_id ?? '') || !UUID.test(body.empresa_id ?? '') || !['crear', 'restablecer'].includes(accion)) {
    return response({ error: 'Datos inválidos.' }, 400)
  }
  const clienteId = body.cliente_id as string
  const empresaId = body.empresa_id as string
  const rpc = caller(jwt)

  // Valida permisos, alcance, habilitación y correo (sin escribir) y devuelve el dominio de la tienda.
  const { data: preparado, error: prepararError } = await rpc.rpc('preparar_cuenta_cliente', { p_cliente: clienteId, p_empresa: empresaId })
  if (prepararError) return rpcError(prepararError)
  const filas = (preparado ?? []) as Preparacion[]
  const preparacion = Array.isArray(filas) ? filas[0] : (filas as Preparacion)
  if (!preparacion?.correo || !preparacion.dominio) return response({ error: NO_SE_PUEDE }, 409)
  const email = preparacion.correo.trim().toLowerCase()
  const redirectTo = `${protocolo}://${preparacion.dominio}/definir-contrasena`

  // El enlace va al correo del usuario de Auth (no al `clientes.correo` actual, que pudo editarse después).
  const correoDeAuth = async (id: string) => {
    const { data, error } = await admin.auth.admin.getUserById(id)
    const correo = error ? null : data?.user?.email?.trim().toLowerCase()
    return correo || null
  }

  if (accion === 'restablecer') {
    // Solo con la cuenta activa en esa tienda (FR-009).
    const { data: cuentas, error: cuentasError } = await rpc.rpc('cuentas_web_de_cliente', { p_cliente: clienteId })
    if (cuentasError) return rpcError(cuentasError)
    const activa = ((cuentas ?? []) as CuentaWeb[]).some((cuenta) => cuenta.empresa_id === empresaId && cuenta.estado === 'activa')
    if (!activa) return response({ error: 'La cuenta web no está activa en esa tienda.' }, 409)
    const destino = preparacion.auth_user_id ? await correoDeAuth(preparacion.auth_user_id) : null
    if (!destino) return response({ error: 'No pudimos enviar el enlace. Inténtalo de nuevo.' }, 502)
    const { error } = await enviarClave(destino, redirectTo)
    if (error) return response({ error: 'No pudimos enviar el enlace. Inténtalo de nuevo.' }, 502)
    // El correo ya salió: si el registro falla no se devuelve error (el operador reintentaría y enviaría otro enlace).
    const { error: actividadError } = await rpc.rpc('registrar_restablecimiento_cuenta_cliente', { p_cliente: clienteId, p_empresa: empresaId })
    if (actividadError) {
      console.error('invitar-cliente: no se registró el restablecimiento', clienteId, empresaId, actividadError.message)
      return response({ ok: true, aviso: 'El enlace se envió, pero no se pudo registrar en la actividad.' })
    }
    return response({ ok: true })
  }

  // Crear: un solo usuario de Auth por cliente (D1). Si el cliente ya tiene cuenta en otra tienda se reutiliza su
  // usuario y se envía el enlace de la nueva tienda; si no, se crea el usuario y el enlace sale tras vincular.
  let usuario = preparacion.auth_user_id
  let invitado: string | null = null
  if (!usuario) {
    // Siempre createUser: el enlace sale recién después de vincular, así un fallo al vincular no deja un correo muerto.
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: false })
    // Un correo ya registrado en Auth (usuario del panel u otra persona) no se invita ni se revela.
    if (error || !data.user) return response({ error: NO_SE_PUEDE }, 409)
    usuario = data.user.id
    invitado = data.user.id
  }

  const { error: vincularError } = await admin.rpc('vincular_cuenta_cliente', {
    p_cliente: clienteId, p_empresa: empresaId, p_auth_user: usuario, p_actor: operador,
  })
  if (vincularError) {
    // Compensación: el usuario recién creado por esta invitación no queda huérfano.
    if (invitado) {
      const { error: borradoError } = await admin.auth.admin.deleteUser(invitado)
      if (borradoError) console.error('invitar-cliente: usuario huérfano tras vincular_cuenta_cliente', invitado, borradoError.message)
    }
    return rpcError(vincularError)
  }

  if (invitar) {
    const destino = await correoDeAuth(usuario)
    const { error } = destino ? await enviarClave(destino, redirectTo) : { error: { message: 'sin correo de Auth' } }
    if (error) return response({ error: 'La cuenta se creó, pero no pudimos enviar el enlace. Usa «Restablecer clave».' }, 502)
  }
  return response({ ok: true })
}
