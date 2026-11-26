// Lógica de `enviar-correo-proveedor` (MSF-525) con dependencias inyectadas para probarla sin Deno ni
// Supabase (handler.test.ts). `index.ts` solo cablea los clientes reales.
// El destinatario NUNCA viene del cliente: se lee de `dominio.proveedores.correo` con la sesión de quien
// llama (RLS acota a su organización). Aun así el texto es libre y el correo del proveedor lo edita cualquiera con
// `edicion`: por eso se valida el correo y el proveedor activo, hay un tope PERSISTENTE por usuario y hora (cupo
// atómico en la base, falla cerrado) y cada envío deja un registro mínimo (usuario, proveedor, resultado; sin
// asunto, cuerpo ni dirección). El cupo y el registro los resuelve index.ts con el cliente admin (solo esas dos RPC);
// los datos del proveedor se leen con la sesión del usuario, sin service-role (lote 91, MSF-731).
import type { EnviarCorreo } from '../_shared/correo.ts'
import { registrarErrorDeBase, textoDeError } from '../_shared/log-seguro.ts'
import { CARACTERES_NO_PERMITIDOS } from '../_shared/texto.ts'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const response = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, ...extra, 'Content-Type': 'application/json' } })

export const ASUNTO_MAX = 200
export const MENSAJE_MAX = 5000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Una sola dirección, sin saltos de línea, invisibles ni bidi (mismo criterio que los avisos): lo que `lineaSegura`
// volvería un espacio no pasa por dirección.
export const CORREO_VALIDO = new RegExp(`^[^\\s@,;<>${CARACTERES_NO_PERMITIDOS}]+@[^\\s@,;<>${CARACTERES_NO_PERMITIDOS}]+\\.[^\\s@,;<>${CARACTERES_NO_PERMITIDOS}]+$`)
export const CORREO_MAX = 254

type Resultado<T> = Promise<{ data: T; error: { message: string } | null }>

export type Deps = {
  getUser(jwt: string): Resultado<{ user: { id: string } | null }>
  // Cliente con la sesión de quien llama: RLS y permisos_actuales() resuelven por su usuario.
  caller(jwt: string): {
    nivelProveedores(): Resultado<string | null>
    proveedor(id: string): Resultado<{ razon_social: string; correo: string | null; activo: boolean } | null>
  }
  enviar: EnviarCorreo
  /** Consume un uso del cupo por usuario y hora. `null` = pasa; un rechazo trae el estado (429 agotado, 503 no verificable) y `retryAfter`. */
  consumirCupo(usuarioId: string): Promise<{ status: number; error: string; retryAfter?: number } | null>
  /** Registro mínimo y persistente de cada envío (sin asunto ni cuerpo): quién, a qué proveedor, cuándo (la base) y el resultado. */
  registrar(evento: { usuarioId: string; proveedorId: string; resultado: 'enviado' | 'fallido' }): Promise<void>
}

export async function manejar(req: Request, { getUser, caller, enviar, consumirCupo, registrar }: Deps): Promise<Response> {
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
    registrarErrorDeBase('enviar-correo-proveedor: no se pudo resolver el permiso', nivelError)
    return response({ error: 'No se pudo verificar tu permiso.' }, 502)
  }
  if (nivel !== 'edicion') return response({ error: 'No tienes permiso para enviar correos a proveedores.' }, 403)

  const { data: proveedor, error: proveedorError } = await cliente.proveedor(body.proveedor_id)
  if (proveedorError) {
    registrarErrorDeBase('enviar-correo-proveedor: no se pudo leer el proveedor', proveedorError)
    return response({ error: 'No se pudo leer el proveedor.' }, 502)
  }
  // Otra organización o inexistente: RLS no devuelve la fila, misma respuesta para no revelar existencia.
  if (!proveedor) return response({ error: 'El proveedor no existe o no pertenece a tu organización.' }, 404)
  if (!proveedor.activo) return response({ error: 'El proveedor está inactivo: reactivalo para enviarle correos.' }, 422)
  const destino = proveedor.correo?.trim()
  if (!destino) return response({ error: 'El proveedor no tiene correo cargado.' }, 422)
  // El correo lo edita cualquier usuario con `edicion` en Proveedores: se valida antes de enviar, no al cargarlo.
  if (destino.length > CORREO_MAX || !CORREO_VALIDO.test(destino)) return response({ error: 'El correo cargado del proveedor no es válido.' }, 422)

  // Tope por usuario y hora: sin esto, el SMTP y el dominio de la empresa servirían de relay para spam o phishing. Se consume
  // DESPUÉS de validar todo (un pedido inválido no gasta cupo) y ANTES de enviar. Si el cupo no se puede verificar, 503 sin enviar.
  const rechazo = await consumirCupo(sesion.user.id)
  if (rechazo) return response({ error: rechazo.error }, rechazo.status, rechazo.retryAfter ? { 'Retry-After': String(rechazo.retryAfter) } : {})

  let resultado: 'enviado' | 'fallido' = 'enviado'
  try {
    await enviar({ para: [destino], asunto, texto: mensaje })
  } catch (error) {
    // Solo nombre y código: el error del cliente SMTP puede traer host, usuario o respuestas del servidor.
    console.error('enviar-correo-proveedor: falló el envío', textoDeError(error))
    resultado = 'fallido'
  }
  // El registro es de mejor esfuerzo: el correo ya salió (o falló) y no se deshace; un fallo del registro se anota sin detalle y no cambia la respuesta.
  try {
    await registrar({ usuarioId: sesion.user.id, proveedorId: body.proveedor_id, resultado })
  } catch (error) {
    console.error('enviar-correo-proveedor: no se pudo registrar el envío', textoDeError(error))
  }
  if (resultado === 'fallido') return response({ error: 'No pudimos enviar el correo. Intentá de nuevo más tarde.' }, 502)
  return response({ resultado: 'correo_enviado' })
}
