// Cupo PERSISTENTE de uso de IA por usuario, funcionalidad y hora (lote 90, MSF-727), como función pura (sin Deno ni Supabase)
// para probarla con `node --test` (cupo-ia.test.ts). Lo consume `public.consumir_cupo_ia` (solo service_role) con el cliente admin:
// el contador vive en la base (`private.ia_cupo_uso`), no en el isolate ni en tablas que el usuario pueda borrar.
// Se llama DESPUÉS de verificar funcionalidad y conversación y ANTES de llamar al proveedor; un error al consumir NO deja pasar (503).
import { leerCampo, limpiarParaLog, recortarSinTokenParcial, redactarCredenciales, textoDeError } from './log-seguro.ts'

export const LIMITE_CUPO_POR_HORA = 30
// Máximo razonable por hora configurable con ENV (igual que el tope de `private.consumir_cupo_ia`): un valor mayor, no entero o no
// positivo vuelve a 30. Sin cota, un valor enorme equivale a cupo abierto y uno que no entra en `int` rompe la RPC (22003).
export const LIMITE_CUPO_MAXIMO = 1000
export const FUNCIONALIDAD_CHAT = 'chat-ia'
export const FUNCIONALIDAD_DOCUMENTOS = 'busqueda-documental'
// No es de IA: `enviar-correo-proveedor` reutiliza el mismo contador atómico (lote 91, MSF-731) con su propia clave de funcionalidad.
export const FUNCIONALIDAD_CORREO_PROVEEDOR = 'correo-proveedor'

// Bordes de MAX_ERROR_LOG (300), MAX_ANTES_DE_TACHAR (2000), UUID sin guiones {32,} y CORREO {1,64}@{1,255} fijados por tests de tabla
// (cupo-ia.test.ts) con n-1 / n / n+1; no hay constantes equivalentes entre ellas.
const MAX_ERROR_LOG = 300
// Antes de tachar se acota a un tamaño holgado, para que el trabajo sea lineal aunque el detalle sea enorme (el recorte final es a 300).
const MAX_ANTES_DE_TACHAR = 2000
const UUID_GENERICO = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
// El mismo uuid sin guiones: una racha de 32 o más hexadecimales (también pegada a letras hexadecimales de ambos lados).
const UUID_SIN_GUIONES = /[0-9a-f]{32,}/gi
const CORREO = /[^\s@]{1,64}@[^\s@]{1,255}/g
// Descripción segura de un error de la RPC (mensaje de Postgres/PostgREST) para el log del servidor: nombre, código y mensaje en UNA línea, con
// credenciales y URLs redactadas (segunda defensa), el id del usuario, cualquier otro uuid y los correos tachados ANTES de acotar a 300 caracteres: como el tachado
// precede al recorte, un uuid completo nunca queda cortado por él y no hace falta descartar nada al final (hacerlo borraría texto legítimo, p. ej. `commit deadbeef`).
function describirError(error: unknown, usuarioId: string): string {
  // Cada lectura es segura: un error hostil (getter que lanza, Proxy) no puede lanzar desde el `catch` que llama a esta función.
  // Orden (igual para un objeto de error y para un string lanzado o devuelto): recorte PREVIO con margen (MAX_ANTES_DE_TACHAR) sin token parcial,
  // aplanado, redacción, tachado y recién al final el recorte a MAX_ERROR_LOG. Recortar a 300 antes de redactar, o dejar un secreto cortado
  // por el margen, mostraría el prefijo de un secreto.
  const e = error && typeof error === 'object' ? error : { message: typeof error === 'string' ? error : limpiarParaLog(error, MAX_ANTES_DE_TACHAR) }
  const partes = [leerCampo(e, 'name'), leerCampo(e, 'code'), leerCampo(e, 'message')].filter((p): p is string => typeof p === 'string' && p !== '')
  let texto = redactarCredenciales(limpiarParaLog(recortarSinTokenParcial(partes.join(' '), MAX_ANTES_DE_TACHAR), MAX_ANTES_DE_TACHAR))
  if (usuarioId) texto = texto.replace(new RegExp(usuarioId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[usuario]')
  return texto.replace(UUID_GENERICO, '[uuid]').replace(UUID_SIN_GUIONES, '[uuid]').replace(CORREO, '[correo]').slice(0, MAX_ERROR_LOG).trim()
}

export type RechazoCupo = { status: number; error: string; retryAfter?: number }
type Rpc = (nombre: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>

// Tope configurable por ENV de cada función; un valor ausente, inválido o mayor que LIMITE_CUPO_MAXIMO vuelve al predeterminado.
export function limiteDeCupo(valor: string | undefined, porDefecto: number = LIMITE_CUPO_POR_HORA): number {
  const n = Number(valor)
  return Number.isInteger(n) && n > 0 && n <= LIMITE_CUPO_MAXIMO ? n : porDefecto
}

// Retry-After en segundos enteros. La SQL devuelve entre 1 y 3600 (hasta la próxima hora en punto UTC); acá: un valor finito mayor que 0 se
// redondea hacia arriba (0.5 -> 1, 1.2 -> 2, 59.01 -> 60) y no pasa de 3600; todo lo demás (no numérico, NaN, Infinity, 0, negativos) cae a
// 3600, el máximo posible de la ventana.
function segundosDeEspera(valor: unknown): number {
  const segundos = Number(valor)
  if (!Number.isFinite(segundos) || segundos <= 0) return 3600
  return Math.min(3600, Math.ceil(segundos))
}

export async function rechazoPorCupo(
  admin: { rpc: Rpc },
  usuarioId: string,
  funcionalidad: string,
  limite: number,
  textos: { agotado: string },
): Promise<RechazoCupo | null> {
  const noVerificable: RechazoCupo = { status: 503, error: 'No se pudo verificar tu cuota de uso.' }
  let data: any
  let error: any
  try {
    ;({ data, error } = await admin.rpc('consumir_cupo_ia', { p_usuario: usuarioId, p_funcionalidad: funcionalidad, p_limite: limite }))
  } catch (excepcion) {
    // La RPC puede lanzar o rechazar la promesa (red, timeout, excepción del cliente): también falla cerrado, sin detalle al cliente.
    // Un error de red/`fetch` se registra como el resto: solo nombre y código (sin mensaje ni URL). `describirError` queda para el error que DEVUELVE la RPC.
    console.error('[cupo-ia] la RPC de cupo lanzó una excepción', { funcionalidad, error: textoDeError(excepcion) })
    return noVerificable
  }
  try {
    const fila = Array.isArray(data) ? data[0] : data
    // Sin respuesta interpretable no se gasta crédito: falla cerrado (503), igual que la verificación de funcionalidad.
    // Observación: quitar la guarda `!fila` es equivalente en el resultado (con `fila` nula el `typeof` lanza, lo caza el `catch` de abajo y también da 503);
    // solo cambia el texto del log.
    if (error || !fila || typeof fila.se_consumio !== 'boolean') {
      console.error('[cupo-ia] no se pudo consumir el cupo', { funcionalidad, error: error ? describirError(error, usuarioId) : 'respuesta no interpretable' })
      return noVerificable
    }
    if (fila.se_consumio) return null
    return { status: 429, error: textos.agotado, retryAfter: segundosDeEspera(fila.segundos_hasta_reinicio) }
  } catch {
    // Una respuesta hostil (getter que lanza, Proxy revocado) tampoco puede romper el fail-closed: 503.
    console.error('[cupo-ia] no se pudo interpretar la respuesta del cupo', { funcionalidad })
    return noVerificable
  }
}

// ¿El fallo del proveedor fue por tiempo de espera? (AbortSignal.timeout / fetch abortado, o el error de negocio que el transporte lanza)
export function esTimeoutDeProveedor(error: unknown): boolean {
  // `leerCampo` tolera null, primitivos y objetos hostiles: no hace falta una guarda previa.
  const name = leerCampo(error, 'name')
  const message = leerCampo(error, 'message')
  return name === 'TimeoutError' || name === 'AbortError' || message === 'INVOCACION_PROVEEDOR_IA_TIMEOUT' || message === 'EMBEDDING_PROVEEDOR_IA_TIMEOUT'
}
