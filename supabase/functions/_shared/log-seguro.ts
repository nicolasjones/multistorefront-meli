// Saneo de lo que las funciones Edge de IA escriben en el log del servidor (lote 90, MSF-727). Sin imports de Deno: se prueba con
// `node --test` (log-seguro.test.ts). Reglas: (1) todo dato variable pasa por `limpiarParaLog` (una sola línea y acotado); (2) los errores
// de red o del proveedor NO se imprimen con su mensaje, `cause` ni URL (pueden traer claves o tokens): solo `textoDeError`, que deja el
// nombre y un código corto; (3) los mensajes de la base se redactan además con `redactarCredenciales` como segunda defensa (nunca es
// exhaustiva: la defensa principal es no imprimir lo que no hace falta).

const CONTROL = /[\r\n\u0000-\u001f\u007f\u2028\u2029]+/g

const MAX_POR_DEFECTO = 300
// `max` válido: entero finito >= 0 (los decimales se truncan: 2.7 -> 2); cualquier otro valor (negativo, NaN, Infinity, no numérico) usa el
// predeterminado de 300. Lo usan `limpiarParaLog` y `mensajeParaLog`, así que ambas dan el mismo resultado para el mismo `max`.
export function normalizarMax(max: unknown): number {
  return typeof max === 'number' && Number.isFinite(max) && max >= 0 ? Math.floor(max) : MAX_POR_DEFECTO
}

// Convierte a texto, descarta lo que sobra ANTES de limpiar (el trabajo no depende del tamaño del dato), reemplaza saltos de línea,
// caracteres de control (incluido NUL), U+2028 y U+2029 por un espacio, acota a `max` y no deja un par sustituto partido al final.
export function limpiarParaLog(valor: unknown, max: number): string {
  max = normalizarMax(max)
  let texto: string
  try { texto = typeof valor === 'string' ? valor : String(valor) } catch { texto = '[no representable]' }
  texto = texto.slice(0, max * 4).replace(CONTROL, ' ').slice(0, max)
  const ultimo = texto.charCodeAt(texto.length - 1)
  return ultimo >= 0xd800 && ultimo <= 0xdbff ? texto.slice(0, -1) : texto
}

const NOMBRE_O_CODIGO = /^[A-Za-z0-9_.:-]{1,64}$/
// Un nombre o `code` que parezca una credencial (`sk-…`, JWT `eyJ…`, `Bearer`) se omite aunque cumpla la clase de caracteres.
const PARECE_CREDENCIAL = /sk-|eyJ|bearer/i
const esSimple = (valor: string) => NOMBRE_O_CODIGO.test(valor) && !PARECE_CREDENCIAL.test(valor)

// Lectura de un campo de un valor que puede ser hostil (getter que lanza, `Proxy` con `get` que lanza o revocado): nunca lanza. Todo lo que
// se llama dentro de un `catch` debe tener esta garantía, o la excepción saldría del `catch` y rompería la respuesta prevista.
export function leerCampo(objeto: unknown, campo: string): unknown {
  try { return (objeto as Record<string, unknown>)[campo] } catch { return undefined }
}
// Códigos de error propios de esta plataforma (llevan el segmento `IA`: INVOCACION_PROVEEDOR_IA_TIMEOUT, POLITICA_IA_INACTIVA…).
const CODIGO_PROPIO = /^(?:[A-Z0-9]+_)*IA(?:_[A-Z0-9]+)*$|^PERSISTENCIA_CHAT_FALLIDA$/

// Descripción de un error para el log SIN su mensaje, `cause` ni URL: el nombre (`TypeError`, `AbortError`…), el `code` si es corto y
// de caracteres simples, y el código propio de la plataforma cuando el mensaje es uno. Un fallo de `fetch` con una clave en la URL
// queda como `TypeError`.
export function textoDeError(error: unknown): string {
  try {
    if (!error || typeof error !== 'object') return typeof error
    const name = leerCampo(error, 'name')
    const code = leerCampo(error, 'code')
    const message = leerCampo(error, 'message')
    const partes = [typeof name === 'string' && esSimple(name) ? name : 'Error']
    if (typeof code === 'string' && esSimple(code)) partes.push(code)
    else if (typeof message === 'string' && message.length <= 64 && CODIGO_PROPIO.test(message)) partes.push(message)
    return partes.join(' ')
  } catch {
    return 'Error'
  }
}

// Segunda defensa para mensajes de la base: credenciales y URLs. Cubre estos formatos y NO es exhaustiva (no redacta `AIza…`, `xoxb-…`, `ghp_…` ni base64 sin prefijo): la defensa principal es no imprimir mensajes de red ni del proveedor. Cada regex es lineal (cuantificadores simples sobre clases) y se aplica
// sobre un texto ya acotado. Orden: URL, JWT, Bearer, clave `sk-`, campos sensibles.
// Cualquier esquema `algo://…` (http, https, postgres, postgresql…); el esquema se acota a 32 caracteres para que sea lineal.
const URL_ = /[a-z][a-z0-9+.-]{0,30}:\/\/\S+/gi
const JWT = /eyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}/g
const BEARER = /Bearer\s+\S+/gi
const CLAVE_SK = /sk-[A-Za-z0-9_-]{10,}/g
// `Authorization: Basic xxx` / `Digest …` / `Token …`: se redacta el esquema Y la credencial (una palabra opcional y el valor).
const AUTORIZACION = /authorization["']?\s*[:=]\s*["']?(?:[a-z]{1,32}\s+)?\S+/gi
// Campos sensibles, también con el nombre embebido en uno más largo (`sb-access-token`, `x-api-key`, `db_password`); el nombre y el valor
// pueden ir entre comillas (JSON): {"api_key":"k"}, 'secret': 'x'. Los prefijos y sufijos del nombre se acotan para que sea lineal.
const CAMPO = /[\w-]{0,40}(?:token|secret|password|passwd|apikey|api_key|api-key)[\w-]{0,40}["']?\s*[:=]\s*\S+/gi

export function redactarCredenciales(texto: string): string {
  return texto
    .replace(URL_, '[url]')
    .replace(JWT, '[jwt]')
    .replace(BEARER, 'Bearer [token]')
    .replace(CLAVE_SK, '[clave]')
    .replace(AUTORIZACION, '[campo]=[oculto]')
    .replace(CAMPO, '[campo]=[oculto]')
}

// Mensaje de la base (PostgREST/Postgres) para el log: una línea, credenciales y URLs redactadas y acotado a `max`. La redacción va SIEMPRE
// antes del recorte final (se redacta sobre `max * 4`; cualquier otro margen mayor es equivalente), así un secreto que cruza el límite no
// deja su prefijo en la salida.
export function mensajeParaLog(valor: unknown, max: number): string {
  const tope = normalizarMax(max)
  return limpiarParaLog(redactarCredenciales(limpiarParaLog(valor, tope * 4)), tope)
}

// Log de un error de la base (`{ code, message }` de PostgREST) con prefijo propio: código acotado a 64 y mensaje saneado y redactado.
export function registrarErrorDeBase(prefijo: string, error: unknown): void {
  console.error(prefijo, limpiarParaLog(leerCampo(error, 'code') ?? '', 64), mensajeParaLog(leerCampo(error, 'message'), 300))
}
