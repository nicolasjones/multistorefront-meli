// Saneo de lo que las funciones Edge de IA escriben en el log del servidor (lote 90, MSF-727). Sin imports de Deno: se prueba con
// `node --test` (log-seguro.test.ts). Reglas: (1) todo dato variable pasa por `limpiarParaLog` (una sola línea y acotado); (2) los errores
// de red o del proveedor NO se imprimen con su mensaje, `cause` ni URL (pueden traer claves o tokens): solo `textoDeError`, que deja el
// nombre y un código corto; (3) los mensajes de la base se redactan además con `redactarCredenciales` como segunda defensa (nunca es
// exhaustiva: la defensa principal es no imprimir lo que no hace falta).

const CONTROL = /[\r\n\u0000-\u001f\u007f\u2028\u2029]+/g

// Convierte a texto, descarta lo que sobra ANTES de limpiar (el trabajo no depende del tamaño del dato), reemplaza saltos de línea,
// caracteres de control (incluido NUL), U+2028 y U+2029 por un espacio, acota a `max` y no deja un par sustituto partido al final.
export function limpiarParaLog(valor: unknown, max: number): string {
  let texto: string
  try { texto = typeof valor === 'string' ? valor : String(valor) } catch { texto = '[no representable]' }
  texto = texto.slice(0, max * 4).replace(CONTROL, ' ').slice(0, max)
  const ultimo = texto.charCodeAt(texto.length - 1)
  return ultimo >= 0xd800 && ultimo <= 0xdbff ? texto.slice(0, -1) : texto
}

const NOMBRE_O_CODIGO = /^[A-Za-z0-9_.:-]{1,64}$/
// Códigos de error propios de esta plataforma (llevan el segmento `IA`: INVOCACION_PROVEEDOR_IA_TIMEOUT, POLITICA_IA_INACTIVA…).
const CODIGO_PROPIO = /^(?:[A-Z0-9]+_)*IA(?:_[A-Z0-9]+)*$|^PERSISTENCIA_CHAT_FALLIDA$/

// Descripción de un error para el log SIN su mensaje, `cause` ni URL: el nombre (`TypeError`, `AbortError`…), el `code` si es corto y
// de caracteres simples, y el código propio de la plataforma cuando el mensaje es uno. Un fallo de `fetch` con una clave en la URL
// queda como `TypeError`.
export function textoDeError(error: unknown): string {
  if (!error || typeof error !== 'object') return typeof error
  const { name, code, message } = error as { name?: unknown; code?: unknown; message?: unknown }
  const partes = [typeof name === 'string' && NOMBRE_O_CODIGO.test(name) ? name : 'Error']
  if (typeof code === 'string' && NOMBRE_O_CODIGO.test(code)) partes.push(code)
  else if (typeof message === 'string' && message.length <= 64 && CODIGO_PROPIO.test(message)) partes.push(message)
  return partes.join(' ')
}

// Segunda defensa para mensajes de la base: credenciales y URLs. Cada regex es lineal (cuantificadores simples sobre clases) y se aplica
// sobre un texto ya acotado. Orden: URL, JWT, Bearer, clave `sk-`, campos sensibles.
const URL_ = /https?:\/\/\S+/gi
const JWT = /eyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}/g
const BEARER = /Bearer\s+\S+/gi
const CLAVE_SK = /sk-[A-Za-z0-9_-]{10,}/g
const CAMPO = /(?:apikey|api_key|api-key|x-api-key|authorization|secret|token|password)\s*[:=]\s*\S+/gi

export function redactarCredenciales(texto: string): string {
  return texto
    .replace(URL_, '[url]')
    .replace(JWT, '[jwt]')
    .replace(BEARER, 'Bearer [token]')
    .replace(CLAVE_SK, '[clave]')
    .replace(CAMPO, '[campo]=[oculto]')
}

// Mensaje de la base (PostgREST/Postgres) para el log: una línea, credenciales y URLs redactadas y acotado a `max`.
export function mensajeParaLog(valor: unknown, max: number): string {
  return limpiarParaLog(redactarCredenciales(limpiarParaLog(valor, max * 4)), max)
}

// Log de un error de la base (`{ code, message }` de PostgREST) con prefijo propio: código acotado a 64 y mensaje saneado y redactado.
export function registrarErrorDeBase(prefijo: string, error: { code?: unknown; message?: unknown }): void {
  console.error(prefijo, limpiarParaLog(error.code ?? '', 64), mensajeParaLog(error.message, 300))
}
