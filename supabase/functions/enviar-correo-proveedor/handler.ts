// Lógica de `enviar-correo-proveedor` (MSF-525) con dependencias inyectadas para probarla sin Deno ni
// Supabase (handler.test.ts). `index.ts` solo cablea los clientes reales.
// El destinatario NUNCA viene del cliente: se lee de `dominio.proveedores.correo` con la sesión de quien
// llama (RLS acota a su organización), así la función no es un relay abierto. Sin service-role.
import type { EnviarCorreo } from '../_shared/correo.ts'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

export const ASUNTO_MAX = 200
export const MENSAJE_MAX = 5000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Resultado<T> = Promise<{ data: T; error: { message: string } | null }>

export type Deps = {
  getUser(jwt: string): Resultado<{ user: { id: string } | null }>
  // Cliente con la sesión de quien llama: RLS y permisos_actuales() resuelven por su usuario.
  caller(jwt: string): {
    nivelProveedores(): Resultado<string | null>
    proveedor(id: string): Resultado<{ razon_social: string; correo: string | null; activo: boolean } | null>
  }
  enviar: EnviarCorreo
}

export async function manejar(req: Request, { getUser, caller, enviar }: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return response({ error: 'Método no soportado.' }, 405)
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return response({ error: 'Falta autenticación.' }, 403)
  const { data: sesion, error: sesionError } = await getUser(jwt)
  if (sesionError || !sesion.user) return response({ error: 'Token inválido o expirado.' }, 403)

  const body = await req.json().catch(() => null) as { proveedor_id?: unknown; asunto?: unknown; mensaje?: unknown } | null
  const asunto = typeof body?.asunto === 'string' ? body.asunto.trim() : ''
  const mensaje = typeof body?.mensaje === 'string' ? body.mensaje.trim() : ''
  if (typeof body?.proveedor_id !== 'string' || !UUID.test(body.proveedor_id)) return response({ error: 'Falta el proveedor.' }, 400)
  if (!asunto || asunto.length > ASUNTO_MAX) return response({ error: `El asunto es obligatorio y admite hasta ${ASUNTO_MAX} caracteres.` }, 400)
  if (!mensaje || mensaje.length > MENSAJE_MAX) return response({ error: `El mensaje es obligatorio y admite hasta ${MENSAJE_MAX} caracteres.` }, 400)

  const cliente = caller(jwt)
  const { data: nivel, error: nivelError } = await cliente.nivelProveedores()
  if (nivelError) {
    console.error('enviar-correo-proveedor: no se pudo resolver el permiso', nivelError.message)
    return response({ error: 'No se pudo verificar tu permiso.' }, 502)
  }
  if (nivel !== 'edicion') return response({ error: 'No tienes permiso para enviar correos a proveedores.' }, 403)

  const { data: proveedor, error: proveedorError } = await cliente.proveedor(body.proveedor_id)
  if (proveedorError) {
    console.error('enviar-correo-proveedor: no se pudo leer el proveedor', proveedorError.message)
    return response({ error: 'No se pudo leer el proveedor.' }, 502)
  }
  // Otra organización o inexistente: RLS no devuelve la fila, misma respuesta para no revelar existencia.
  if (!proveedor) return response({ error: 'El proveedor no existe o no pertenece a tu organización.' }, 404)
  if (!proveedor.correo) return response({ error: 'El proveedor no tiene correo cargado.' }, 422)

  try {
    await enviar({ para: [proveedor.correo], asunto, texto: mensaje })
  } catch (error) {
    console.error('enviar-correo-proveedor: falló el envío', error instanceof Error ? error.message : error)
    return response({ error: 'No pudimos enviar el correo. Intentá de nuevo más tarde.' }, 502)
  }
  return response({ resultado: 'correo_enviado' })
}
