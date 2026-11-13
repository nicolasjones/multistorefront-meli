// Lógica de `enviar-aviso-faltante` (F-STK-17, FR-308) con dependencias inyectadas para probarla sin
// Deno, Supabase ni SMTP (handler.test.ts). `index.ts` solo cablea los clientes reales.
// No la llama el navegador: la invoca el flow de Kestra `avisos-faltantes` (barrido) o un operador, con el
// secreto compartido AVISOS_FALTANTES_TOKEN en `x-aviso-token`. El destinatario NUNCA viene del pedido:
// lo resuelve la base (`tomar_aviso_faltante`), así la función no es un relay abierto.
// Un correo por cliente con todos sus faltantes. Garantía: al menos una vez. Si el correo salió pero la
// base no pudo cerrar el aviso, se reintenta pasada la reserva y puede llegar un duplicado (se prefiere
// eso a perder el aviso). Un fallo de envío nunca toca la venta ni el stock.
import { timingSafeEqual } from 'node:crypto'
import type { EnviarCorreo } from '../_shared/correo.ts'
import { CARACTERES_NO_PERMITIDOS } from '../_shared/texto.ts'
import type { CodigoError } from './codigos.ts'
import { asuntoAviso, cuerpoAviso, type LineaFaltante } from './contenido.ts'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-aviso-token' }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

export const MAX_INTENTOS = 5
export const LIMITE_BARRIDO = 50
/**
 * Presupuesto de reloj de un barrido: no se EMPIEZA otro cliente si ya pasó. El peor caso es un cliente que arranca justo
 * antes del corte y tarda el timeout del envío (30 s) + el cierre del cliente (5 s) + las RPC, por eso el presupuesto
 * deja margen bajo el límite de la función (150 s): 60 + 30 + 5 + RPC < 150. Lo que queda lo toma el barrido siguiente
 * (Kestra repite cada minuto).
 */
export const PRESUPUESTO_BARRIDO_MS = 60_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Sin coma, punto y coma, comillas ni ángulos: una sola dirección (m-3). Tampoco controles ni invisibles/bidi (los mismos que
// `lineaSegura` convertiría en un espacio dentro de `to`).
const NO_DIRECCION = `\\s@,;<>"${CARACTERES_NO_PERMITIDOS}`
export const CORREO_VALIDO = new RegExp(`^[^${NO_DIRECCION}]+@[^${NO_DIRECCION}]+\\.[^${NO_DIRECCION}]+$`)

type Resultado<T> = Promise<{ data: T; error: { message: string; code?: string } | null }>

export type EstadoAviso = 'enviado' | 'fallido' | 'nada'

export type Tomado = {
  cliente: string | null
  correo: string | null
  lineas: LineaFaltante[] | null
  /** Token de la tanda: el cierre solo toca las líneas de esta tanda (M-2). */
  tanda?: string | null
}

export type { CodigoError } from './codigos.ts'

export type Deps = {
  /** Secreto compartido con Kestra (AVISOS_FALTANTES_TOKEN); sin él la función rechaza todo. */
  token: string | undefined
  datos: {
    pendientes(tope: number, limite: number): Resultado<string[] | null>
    tomar(clienteId: string, tope: number): Resultado<Tomado[] | null>
    cerrar(clienteId: string, enviado: boolean, error: string | null, tope: number, tanda: string | null): Resultado<unknown>
  }
  enviar: EnviarCorreo
  /**
   * Sonda del esquema (opcional): falla si la base no tiene la migración (falta `cerrar_aviso_faltante` con `p_tanda`).
   * Se llama ANTES de tomar nada: con una base sin migrar no se gastan intentos ni se envía.
   */
  sonda?: () => Resultado<unknown>
  /** Reloj en ms (inyectable para probar el corte del barrido). */
  ahora?: () => number
}

const tokenValido = (esperado: string | undefined, recibido: string | null) => {
  if (!esperado || !recibido) return false
  const a = new TextEncoder().encode(esperado)
  const b = new TextEncoder().encode(recibido)
  return a.length === b.length && timingSafeEqual(a, b)
}

// El error del SMTP puede traer direcciones, hosts o usuarios (p. ej. «535 Authentication failed for user smtp-prod@host»).
// `ultimo_error` lo lee el panel (cualquiera con `ventas` en la tienda): ahí solo va un código genérico y el
// detalle, con las direcciones saneadas, queda únicamente en el log de la función.
const CORREO_EN_ERROR = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const DETALLE_MAX = 300

const textoDeError = (error: unknown) => (error instanceof Error ? error.message : String(error))

const mensajeDeError = (error: unknown) =>
  textoDeError(error).replace(CORREO_EN_ERROR, '[correo]').replace(/\s+/g, ' ').trim().slice(0, DETALLE_MAX) || 'Error de envío sin detalle'

const ERRORES_DE_RED_DENO = new Set(['NotFound', 'ConnectionRefused', 'ConnectionReset', 'ConnectionAborted', 'NotConnected', 'AddrNotAvailable', 'BrokenPipe', 'TimedOut'])
const ERRORES_DE_RED_NODE = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'EPIPE', 'ECONNABORTED'])

/**
 * Clasifica una falla de envío en un código genérico (nunca el texto del servidor).
 * - `smtp_timeout`: SOLO el corte propio durante el envío («smtp timeout», `conTimeout` sobre `send`): el DATA pudo haberse
 *   enviado y no se sabe si el correo salió; es un intento INCIERTO (la base lo deja `agotado`, sin reintento automático).
 * - `smtp_conexion`: no se pudo alcanzar el servidor (corte propio de la fase de conexión «smtp conexion timeout», errores de
 *   red del sistema): no salió nada, es reintentable.
 * - Respuestas del servidor, por su CÓDIGO NUMÉRICO (al comienzo del mensaje o seguido del código mejorado `x.y.z`; un número
 *   suelto como «port 535» no cuenta): 4xx transitorio -> `otro` (reintentable); 530/534/535 -> `smtp_auth`; 550-554 ->
 *   `destinatario_invalido` si el texto habla del destinatario/casilla y `otro` si no (`relaying denied`, `size exceeded`, `spam`,
 *   remitente rechazado, casilla llena, lista de destinatarios demasiado grande); un 5xx de «autenticación requerida» es `smtp_auth`.
 */
export function codigoDeError(error: unknown): CodigoError {
  const nombre = error instanceof Error ? error.name : ''
  const texto = textoDeError(error)
  // Fallas de RED por su nombre o código (aunque el mensaje no diga nada): Deno (`NotFound` por DNS, `ConnectionRefused`, ...) y
  // Node (`ECONNREFUSED`, ...). No salió nada: `smtp_conexion`, reintentable. `smtp_timeout` queda SOLO para el corte propio del envío.
  const codigoRed = (error as { code?: unknown } | null)?.code
  if (ERRORES_DE_RED_DENO.has(nombre) || (typeof codigoRed === 'string' && ERRORES_DE_RED_NODE.has(codigoRed))) return 'smtp_conexion'
  // Configuración TLS/credenciales (nuestra, no del servidor): no es un problema de autenticación. Va ANTES de las palabras de
  // autenticación porque el mensaje de denomailer («Don't send authentication over non secure connection») las contiene.
  if (/not secure|non secure|insecure connection|Configuración SMTP/i.test(texto)) return 'otro'
  if (nombre === 'TimeoutError') return /^smtp conexion/i.test(texto) ? 'smtp_conexion' : /^smtp timeout/i.test(texto) ? 'smtp_timeout' : 'smtp_conexion'
  const codigo = /^\s*(?:[^:\d]{0,40}:\s*)?([2-5]\d\d)(?=[ -])|[\s:]([2-5]\d\d)[ -]\d\.\d{1,3}\.\d{1,3}\b/.exec(texto)
  const n = Number(codigo?.[1] ?? codigo?.[2] ?? 0)
  if (n >= 400 && n < 500) return 'otro'
  // 530 «Must issue a STARTTLS first» / 530-535 de autenticación: el servidor niega el acceso por la configuración del envío
  // (credenciales o TLS del lado nuestro), no por el correo del cliente: `smtp_auth`.
  if (n === 530 || n === 534 || n === 535) return 'smtp_auth'
  if (n >= 550 && n <= 554) {
    // Un 5xx puede decir «autenticación requerida» (5.7.x): configuración nuestra.
    if (/authenticat|auth required|starttls/i.test(texto)) return 'smtp_auth'
    // Problemas del REMITENTE, de cuota o de volumen no son un correo de cliente inválido: `otro` (cada alternativa tiene su test).
    if (/sender|quota|list too (large|long)|too many recipients/i.test(texto)) return 'otro'
    return /recipient|user unknown|no such user|unknown user|invalid address|mailbox (unavailable|not found|does not exist|disabled)/i.test(texto) ? 'destinatario_invalido' : 'otro'
  }
  // Sin código del servidor: por palabras.
  if (/authenticat|credential|login failed|invalid (user|password)/i.test(texto)) return 'smtp_auth'
  if (/recipient|user unknown|no such user|invalid address/i.test(texto) && !/sender/i.test(texto)) return 'destinatario_invalido'
  if (/econn|enotfound|ehostunreach|etimedout|timed out|timedout|timeout|connect|connection|socket|tls|ssl|dns|refused|reset|broken pipe/i.test(texto)) return 'smtp_conexion'
  return 'otro'
}

/** Procesa los avisos de un cliente: toma, envía un correo y cierra. Idempotente por cliente. */
export async function procesarCliente(clienteId: string, deps: Deps): Promise<EstadoAviso> {
  const { data, error } = await deps.datos.tomar(clienteId, MAX_INTENTOS)
  if (error || !data) throw new Error(`No se pudo tomar el aviso: ${error?.message ?? 'sin respuesta'}`)
  // Sin filas: otra invocación lo tiene reservado, ya se envió o no quedó nada vigente.
  if (data.length === 0 || !data[0].lineas?.length) return 'nada'
  const fila = data[0]
  // Falla cerrado ante una base sin migrar: sin el token de tanda el cierre no podría proteger a una tanda nueva y un
  // correo ya enviado se reenviaría cada 2 minutos. Orden de despliegue: la migración ANTES que esta función.
  if (!fila.tanda) {
    throw new Error('La base no devolvió el token de tanda: falta aplicar la migración 20270306120000 antes de desplegar la función')
  }

  const tanda = fila.tanda
  const cerrarFallido = async (codigo: CodigoError) => {
    const cierre = await deps.datos.cerrar(clienteId, false, codigo, MAX_INTENTOS, tanda)
    if (cierre.error) console.error('enviar-aviso-faltante: no se pudo registrar el fallo', clienteId, cierre.error.message)
    return 'fallido' as const
  }

  // El correo del cliente lo carga una persona: se valida antes de usarlo como destinatario.
  if (!CORREO_VALIDO.test(fila.correo ?? '') || (fila.correo ?? '').length > 254) {
    return cerrarFallido('destinatario_invalido')
  }

  try {
    await deps.enviar({
      para: [fila.correo as string],
      asunto: asuntoAviso(),
      texto: cuerpoAviso(fila.cliente ?? '', fila.lineas),
    })
  } catch (falla) {
    const codigo = codigoDeError(falla)
    console.error('enviar-aviso-faltante: falló el envío', clienteId, codigo, mensajeDeError(falla))
    return cerrarFallido(codigo)
  }

  const cierre = await deps.datos.cerrar(clienteId, true, null, MAX_INTENTOS, tanda)
  if (cierre.error) console.error('enviar-aviso-faltante: el correo salió pero no se pudo cerrar el aviso', clienteId, cierre.error.message)
  return 'enviado'
}

/** Errores de PostgREST/Postgres que significan «la función/columna no existe»: la base NO tiene la migración. */
const CODIGOS_ESQUEMA_FALTANTE = new Set(['PGRST202', 'PGRST204', '42883', '42703'])
const MENSAJE_ESQUEMA_FALTANTE = /could not find the function|function .* does not exist|column .* does not exist/i

export const esErrorDeEsquemaFaltante = (error: { message: string; code?: string }) =>
  (error.code !== undefined && CODIGOS_ESQUEMA_FALTANTE.has(error.code)) || MENSAJE_ESQUEMA_FALTANTE.test(error.message)

/**
 * Verifica el esquema antes de tomar nada; devuelve la respuesta de error o `null` si está todo bien.
 * Distingue «la base no está migrada» (503, hay que aplicar la migración) de «no se pudo consultar la base» (502: caída, red o
 * permisos): ante una caída NO se dice «no migrada». Los mensajes son constantes: el detalle va solo al log.
 */
async function esquemaListo(deps: Deps): Promise<Response | null> {
  if (!deps.sonda) return null
  const { error } = await deps.sonda()
  if (!error) return null
  if (esErrorDeEsquemaFaltante(error)) {
    console.error('enviar-aviso-faltante: la base no está migrada (falta cerrar_aviso_faltante con p_tanda)', error.code ?? '', error.message)
    return response({ error: 'La base no está migrada: aplicá la migración 20270306120000 antes de desplegar esta función.', codigo: 'base_no_migrada' }, 503)
  }
  console.error('enviar-aviso-faltante: no se pudo verificar la base', error.code ?? '', error.message)
  return response({ error: 'No se pudo verificar la base de datos.', codigo: 'base_no_disponible' }, 502)
}

export async function manejar(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return response({ error: 'Método no soportado.' }, 405)
  if (!deps.token) {
    console.error('enviar-aviso-faltante: falta AVISOS_FALTANTES_TOKEN')
    return response({ error: 'La función no está configurada.' }, 503)
  }
  if (!tokenValido(deps.token, req.headers.get('x-aviso-token'))) return response({ error: 'Falta autenticación.' }, 403)

  const body = await req.json().catch(() => null) as { cliente_id?: unknown; barrer?: unknown } | null

  if (body?.barrer === true) {
    const sinEsquema = await esquemaListo(deps)
    if (sinEsquema) return sinEsquema
    const { data: ids, error } = await deps.datos.pendientes(MAX_INTENTOS, LIMITE_BARRIDO)
    if (error) {
      console.error('enviar-aviso-faltante: no se pudo listar los pendientes', error.message)
      return response({ error: 'No se pudieron leer los avisos pendientes.' }, 502)
    }
    const resultados: Partial<Record<EstadoAviso, number>> = {}
    let errores = 0
    let procesados = 0
    const ahora = deps.ahora ?? Date.now
    const inicio = ahora()
    for (const id of ids ?? []) {
      // Corta por reloj: no se empieza otro cliente si ya se gastó el presupuesto del barrido.
      if (ahora() - inicio >= PRESUPUESTO_BARRIDO_MS) break
      procesados += 1
      try {
        const estado = await procesarCliente(id, deps)
        resultados[estado] = (resultados[estado] ?? 0) + 1
      } catch (falla) {
        errores += 1
        console.error('enviar-aviso-faltante: aviso con error', id, mensajeDeError(falla))
      }
    }
    const cuerpo = { procesados, resultados, errores, ...(procesados < (ids ?? []).length ? { pendientes: (ids ?? []).length - procesados } : {}) }
    // Si TODOS fallaron (p. ej. base sin migrar o caída de la base), Kestra tiene que ver un error y no un 200 silencioso.
    if (errores > 0 && errores === procesados) return response({ ...cuerpo, error: 'Ningún aviso se pudo procesar.' }, 502)
    return response(cuerpo)
  }

  if (typeof body?.cliente_id !== 'string' || !UUID.test(body.cliente_id)) return response({ error: 'Falta el cliente.' }, 400)
  const sinEsquema = await esquemaListo(deps)
  if (sinEsquema) return sinEsquema
  try {
    return response({ estado: await procesarCliente(body.cliente_id, deps) })
  } catch (falla) {
    console.error('enviar-aviso-faltante: error inesperado', mensajeDeError(falla))
    return response({ error: 'No se pudo procesar el aviso.' }, 502)
  }
}
