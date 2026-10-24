// Lógica de `recuperar-clave-cliente` (F-CLI-06, FR-023) con dependencias inyectadas para poder probarla sin Deno
// ni Supabase (handler.test.ts). `index.ts` solo cablea los clientes reales.
//
// Es anónima: cualquiera puede llamarla, así que la respuesta es SIEMPRE la misma (`{ ok: true }`) exista o no la
// cuenta, y un fallo al consultar o al enviar solo se registra en el log (no cambia lo que ve quien llama).
// Sin esto se podrían enumerar los correos con cuenta web en una tienda. Tampoco debe filtrarse por tiempo: la
// consulta y el envío corren en segundo plano (`enSegundoPlano`), así que se responde al instante en ambos casos.

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
  // Mantiene viva la tarea tras responder (`EdgeRuntime.waitUntil` en Deno). Nunca rechaza.
  enSegundoPlano(tarea: Promise<void>): void
  // Reloj inyectable para el límite por correo.
  ahora?: () => number
}

// Límite simple por correo+tienda (mejor esfuerzo, por instancia): evita usar la función para inundar de correos a
// un cliente conocido. Lo que exceda se descarta en silencio, con la misma respuesta (no filtra nada).
const VENTANA_MS = 10 * 60 * 1000
const MAXIMO_POR_VENTANA = 3
const MAXIMO_CLAVES = 5000
const intentos = new Map<string, number[]>()

function dentroDelLimite(clave: string, ahora: number): boolean {
  if (intentos.size > MAXIMO_CLAVES) intentos.clear()
  const recientes = (intentos.get(clave) ?? []).filter((t) => ahora - t < VENTANA_MS)
  if (recientes.length >= MAXIMO_POR_VENTANA) {
    intentos.set(clave, recientes)
    return false
  }
  recientes.push(ahora)
  intentos.set(clave, recientes)
  return true
}

const CORREO = /^[^\s@]+@[^\s@]+$/
const HOST = /^[a-z0-9.-]+(:[0-9]+)?$/i

export async function manejar(req: Request, { protocolo, admin, enviarClave, enSegundoPlano, ahora = Date.now }: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return response({ error: 'Método no soportado.' }, 405)

  const body = await req.json().catch(() => null) as { host?: unknown; correo?: unknown } | null
  const host = typeof body?.host === 'string' ? body.host.trim() : ''
  const correo = typeof body?.correo === 'string' ? body.correo.trim().toLowerCase() : ''
  // La forma inválida no depende de que exista una cuenta, así que puede rechazarse sin filtrar nada.
  if (!host || host.length > 255 || !HOST.test(host) || !correo || correo.length > 320 || !CORREO.test(correo)) {
    return response({ error: 'Datos inválidos.' }, 400)
  }

  const procesar = async (): Promise<void> => {
    try {
      const { data, error } = await admin.rpc('cuenta_cliente_para_recuperar', { p_host: host, p_correo: correo })
      if (error) throw new Error(error.message)
      const filas = (data ?? []) as CuentaRecuperable[]
      const cuenta = Array.isArray(filas) ? filas[0] : (filas as CuentaRecuperable)
      if (cuenta?.correo && cuenta.dominio) {
        if (!dentroDelLimite(`${host.toLowerCase()}|${correo}`, ahora())) {
          console.error('recuperar-clave-cliente: límite por correo alcanzado, no se reenvía')
          return
        }
        // El dominio sale de la base (el de la tienda), nunca del `host` recibido: la redirección no es manipulable.
        const { error: envioError } = await enviarClave(cuenta.correo, `${protocolo}://${cuenta.dominio}/definir-contrasena`)
        if (envioError) throw new Error(envioError.message)
      }
    } catch (cause) {
      console.error('recuperar-clave-cliente: no se pudo procesar el pedido', cause instanceof Error ? cause.message : cause)
    }
  }
  enSegundoPlano(procesar())
  return response({ ok: true })
}
