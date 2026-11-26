// Saneo de lo que las funciones Edge de IA escriben en el log del servidor (lote 90, MSF-727). Sin imports de Deno: se prueba con
// `node --test` (log-seguro.test.ts). Reglas: (1) todo dato variable pasa por `limpiarParaLog` (una sola línea y acotado); (2) los errores
// de red o del proveedor NO se imprimen con su mensaje, `cause` ni URL (pueden traer claves o tokens): solo `textoDeError`, que deja el
// nombre y un código corto; (3) los mensajes de la base se redactan además con `redactarCredenciales` como segunda defensa (nunca es
// exhaustiva: la defensa principal es no imprimir lo que no hace falta).

// Equivalente declarado: extender el rango `\u0000-\u001f` hasta `\u0020` (el espacio) no cambia nada, porque el espacio se reemplaza por un espacio.
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

function aTexto(valor: unknown): string {
  try { return typeof valor === 'string' ? valor : String(valor) } catch { return '[no representable]' }
}

const BLANCO = /[\s\u0000-\u001f\u007f]/
const COLA_SIN_BLANCOS = 64

// Recorte PREVIO a una redacción (nunca el recorte final): si el texto excede `max`, lo corta en `max` y descarta el último token PARCIAL,
// porque un secreto cortado a la mitad ya no lo reconocen los patrones de redacción y su prefijo sobreviviría si una redacción posterior
// acorta el texto. Reglas: (1) si el texto cabe en `max` se devuelve igual; (2) si el carácter que sigue al corte es un blanco, el último token
// está completo y se conserva; (3) si no, se retrocede hasta el último blanco del tramo (se descarta el token parcial); (4) si el tramo no
// tiene ningún blanco (un texto largo sin espacios), se descartan sus últimos 64 caracteres. Solo mira los primeros `max + 1` caracteres.
export function recortarSinTokenParcial(texto: string, max: number): string {
  if (texto.length <= max) return texto
  if (BLANCO.test(texto.charAt(max))) return texto.slice(0, max)
  const corte = texto.slice(0, max)
  for (let i = corte.length - 1; i >= 0; i--) if (BLANCO.test(corte.charAt(i))) return corte.slice(0, i)
  return corte.slice(0, Math.max(0, max - COLA_SIN_BLANCOS))
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

// Segunda defensa para mensajes de la base: credenciales y URLs. Cubre estos formatos y NO es exhaustiva (no redacta `AIza…`, `xoxb-…`,
// `ghp_…` ni base64 sin prefijo): la defensa principal es no imprimir mensajes de red ni del proveedor. Orden: URL, JWT, Bearer, clave `sk-`,
// y campos sensibles (que ocultan el resto del mensaje).
// Tiempo acotado POR CONSTRUCCIÓN, no por afirmar que cada regex sea lineal (el JWT, con sus tres segmentos, no lo es): (1) la función
// acota la entrada a MAX_ENTRADA_REDACCION caracteres antes de cualquier regex (la salida también queda acotada: no pasa de unas pocas veces el tope, porque una redacción como `Bearer [token]` puede alargar un poco; no es un texto completo);
// (2) los cuantificadores de los patrones están acotados (esquema de URL, segmentos del JWT, sufijo del nombre de campo, comillas y espacios). Medido: 200k
// caracteres hostiles por variante tardan decenas de milisegundos (log-seguro.test.ts).
export const MAX_ENTRADA_REDACCION = 4000
// Cualquier esquema `algo://…` (http, https, postgres, postgresql…).
const URL_ = /[a-z][a-z0-9+.-]{0,30}:\/\/\S+/gi
// Un JWT real rara vez pasa de 2000 caracteres por segmento.
const JWT = /eyJ[\w-]{5,2000}\.[\w-]{5,2000}\.[\w-]{5,2000}/g
const BEARER = /Bearer\s+\S+/gi
const CLAVE_SK = /sk-[A-Za-z0-9_-]{10,}/g
// Campos sensibles: a partir de la PRIMERA aparición de un nombre sensible seguido de `:` o `=` se oculta TODO lo que sigue hasta el final
// del mensaje (sobre-redacción deliberada: es diagnóstico, y no se intenta adivinar dónde termina un valor con espacios, comillas o JSON
// escapado). El nombre puede estar embebido en uno más largo (`sb-access-token`, `x-api-key`, `db_password`) y rodeado de comillas o barras
// invertidas (`"api_key":`, `\"api_key\":`). Sufijo (40), comillas (4) y espacios (16) tienen su borde cubierto por tests. El PREFIJO `{0,40}` del nombre es
// solo un tope de rendimiento y NO tiene efecto observable (el prefijo queda dentro del grupo 1 y se imprime igual con cualquier tope): equivalente declarado.
const CAMPO = /([\w-]{0,40}(?:password|passwd|secret|token|apikey|api_key|api-key|authorization|credential|cookie)[\w-]{0,40}[\\"']{0,4}\s{0,16}[:=])[\s\S]*/i

export function redactarCredenciales(texto: string): string {
  // Recorte PREVIO a la redacción: sin token parcial (recortarSinTokenParcial).
  return recortarSinTokenParcial(typeof texto === 'string' ? texto : limpiarParaLog(texto, MAX_ENTRADA_REDACCION), MAX_ENTRADA_REDACCION)
    .replace(URL_, '[url]')
    .replace(JWT, '[jwt]')
    .replace(BEARER, 'Bearer [token]')
    .replace(CLAVE_SK, '[clave]')
    .replace(CAMPO, '$1 [oculto]')
}

// Mensaje de la base (PostgREST/Postgres) para el log: una línea, credenciales y URLs redactadas y acotado a `max`. Orden: recorte PREVIO con
// margen `max * 4` sin token parcial (recortarSinTokenParcial), aplanado, redacción y recorte final a `max`. El margen `* 4` está fijado por
// test en ambos sentidos: uno menor perdería texto que sobrevive a una redacción que acorta (p. ej. una URL larga) y uno mayor mostraría más;
// el descarte del token parcial evita que un secreto cortado por el margen deje su prefijo si una redacción posterior acorta el texto.
export function mensajeParaLog(valor: unknown, max: number): string {
  const tope = normalizarMax(max)
  const previo = limpiarParaLog(recortarSinTokenParcial(aTexto(valor), tope * 4), tope * 4)
  return limpiarParaLog(redactarCredenciales(previo), tope)
}

// Log de un error de la base (`{ code, message }` de PostgREST) con prefijo propio: código acotado a 64 y mensaje saneado y redactado.
export function registrarErrorDeBase(prefijo: string, error: unknown): void {
  console.error(prefijo, limpiarParaLog(leerCampo(error, 'code') ?? '', 64), mensajeParaLog(leerCampo(error, 'message'), 300))
}
