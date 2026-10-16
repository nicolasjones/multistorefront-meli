// Lógica de `solicitar-acceso` (F-ROL-05, FR-008) con dependencias inyectadas para poder probarla sin
// Deno, Supabase ni SMTP (handler.test.ts). `index.ts` solo cablea los clientes reales.
import type { EnviarCorreo } from '../_shared/correo.ts'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

type DbError = { message: string; code?: string }
type Resultado<T = unknown> = Promise<{ data: T; error: DbError | null }>

export type ResultadoRpc = { id: string; organizacion_id: string; nuevo: boolean; correo_enviado: boolean }

export type Deps = {
  verificarJwt(jwt: string): Promise<{ id: string; email: string | null } | null>
  // deno-lint-ignore no-explicit-any
  caller(jwt: string): { rpc(nombre: string, args: Record<string, unknown>): Resultado<any> }
  datos: {
    // Marca atómica `correo_enviado_en = now()` solo si seguía null: true para quien la ganó. Evita el
    // doble envío con doble clic o reintentos concurrentes.
    reclamarEnvio(id: string): Promise<boolean>
    liberarEnvio(id: string): Promise<void>
    administradoresActivos(organizacionId: string): Promise<string[]>
    nombreVisible(userId: string): Promise<string | null>
  }
  enviar: EnviarCorreo
}

const rpcError = (error: DbError) => {
  if (error.code === '42501') return response({ error: 'No tienes permiso para solicitar acceso en esta organización.' }, 403)
  if (error.code === '22023' && (error.message === 'Sección inválida' || error.message === 'Ya tienes acceso a esta sección')) {
    return response({ error: error.message }, 400)
  }
  return response({ error: 'No se pudo completar la operación.' }, 400)
}

const etiquetaSeccion = (clave: string) => {
  const texto = clave.replace(/_/g, ' ')
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

export async function manejar(req: Request, { verificarJwt, caller, datos, enviar }: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return response({ error: 'Método no soportado.' }, 405)
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return response({ error: 'Falta autenticación.' }, 403)
  const usuario = await verificarJwt(jwt)
  if (!usuario) return response({ error: 'Token inválido o expirado.' }, 403)

  const body = await req.json().catch(() => null) as { seccion?: unknown } | null
  if (typeof body?.seccion !== 'string' || !body.seccion || body.seccion.length > 60) return response({ error: 'Sección inválida' }, 400)

  const { data, error } = await caller(jwt).rpc('solicitar_acceso', { p_seccion: body.seccion })
  if (error) return rpcError(error)
  const registro = data as ResultadoRpc

  // El correo del día ya salió: mismo resultado, sin reenviar (escenario 3).
  if (registro.correo_enviado) return response({ resultado: 'solicitud_enviada', nuevo: false })
  // Otra invocación concurrente ganó el envío: el pedido está registrado y ella lo avisa.
  if (!(await datos.reclamarEnvio(registro.id))) return response({ resultado: 'solicitud_enviada', nuevo: registro.nuevo })

  try {
    const destinatarios = await datos.administradoresActivos(registro.organizacion_id)
    if (destinatarios.length === 0) {
      // El registro no se pierde; se libera para que un reintento avise cuando haya administrador.
      await datos.liberarEnvio(registro.id)
      return response({ resultado: 'sin_administradores', nuevo: registro.nuevo })
    }
    const nombre = (await datos.nombreVisible(usuario.id)) ?? usuario.email ?? 'Una persona de tu organización'
    const seccion = etiquetaSeccion(body.seccion)
    await enviar({
      para: destinatarios,
      asunto: `Solicitud de acceso a ${seccion}`,
      texto: `${nombre}${usuario.email ? ` (${usuario.email})` : ''} pidió acceso a la sección ${seccion}.\n\nPodés revisar su rol desde Usuarios y permisos.`,
    })
  } catch (e) {
    console.error('solicitar-acceso: no se pudo enviar el aviso', e instanceof Error ? e.message : e)
    await datos.liberarEnvio(registro.id).catch((err) => console.error('solicitar-acceso: no se pudo liberar el envío', registro.id, err))
    return response({ error: 'Tu solicitud quedó registrada, pero no pudimos avisar al administrador. Intentá de nuevo.' }, 502)
  }
  return response({ resultado: 'solicitud_enviada', nuevo: registro.nuevo })
}
