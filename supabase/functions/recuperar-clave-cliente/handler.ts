// Lógica de `recuperar-clave-cliente` (F-CLI-06, FR-023) con dependencias inyectadas para poder probarla sin Deno
// ni Supabase (handler.test.ts). `index.ts` solo cablea los clientes reales.
//
// Es anónima: cualquiera puede llamarla, así que la respuesta es SIEMPRE la misma (`{ ok: true }`) exista o no la
// cuenta, y un fallo al consultar o al enviar solo se registra en el log (no cambia lo que ve quien llama).
// Sin esto se podrían enumerar los correos con cuenta web en una tienda.

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

type DbError = { message: string; code?: string }
type Resultado<T = unknown> = Promise<{ data: T; error: DbError | null }>
type CuentaRecuperable = { correo: string; dominio: string }

export type Deps = {
  // `http` solo en desarrollo local; en cualquier otro entorno las tiendas viven en https.
  protocolo: 'https' | 'http'
  // Solo `cuenta_cliente_para_recuperar` (restringida a service_role).
  admin: { rpc(nombre: string, args: Record<string, unknown>): Resultado<unknown> }
  // Envía el correo de Auth (plantilla de recuperación) con redirección a la tienda.
  enviarClave(email: string, redirectTo: string): Resultado<unknown>
}

const CORREO = /^[^\s@]+@[^\s@]+$/
const HOST = /^[a-z0-9.-]+(:[0-9]+)?$/i

export async function manejar(req: Request, { protocolo, admin, enviarClave }: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return response({ error: 'Método no soportado.' }, 405)

  const body = await req.json().catch(() => null) as { host?: unknown; correo?: unknown } | null
  const host = typeof body?.host === 'string' ? body.host.trim() : ''
  const correo = typeof body?.correo === 'string' ? body.correo.trim().toLowerCase() : ''
  // La forma inválida no depende de que exista una cuenta, así que puede rechazarse sin filtrar nada.
  if (!host || host.length > 255 || !HOST.test(host) || !correo || correo.length > 320 || !CORREO.test(correo)) {
    return response({ error: 'Datos inválidos.' }, 400)
  }

  try {
    const { data, error } = await admin.rpc('cuenta_cliente_para_recuperar', { p_host: host, p_correo: correo })
    if (error) throw new Error(error.message)
    const filas = (data ?? []) as CuentaRecuperable[]
    const cuenta = Array.isArray(filas) ? filas[0] : (filas as CuentaRecuperable)
    if (cuenta?.correo && cuenta.dominio) {
      // El dominio sale de la base (el de la tienda), nunca del `host` recibido: la redirección no es manipulable.
      const { error: envioError } = await enviarClave(cuenta.correo, `${protocolo}://${cuenta.dominio}/definir-contrasena`)
      if (envioError) throw new Error(envioError.message)
    }
  } catch (cause) {
    console.error('recuperar-clave-cliente: no se pudo procesar el pedido', cause instanceof Error ? cause.message : cause)
  }
  return response({ ok: true })
}
