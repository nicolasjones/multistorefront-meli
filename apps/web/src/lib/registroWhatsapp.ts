import { supabaseClient } from './supabase'
import { esIdValido } from './tiendaListado'

// F-TDA-14 (MSF-433): registro del interés por WhatsApp desde la ficha (FR-024). El visitante abre
// WhatsApp y la consulta llega a la bandeja de Consultas y ventas de esa empresa con origen `whatsapp`.
// El registro NUNCA bloquea la apertura ni muestra fallas o límite al visitante (D3): si algo falla, se
// registra en la consola y el visitante sigue con su WhatsApp abierto. Lo que decide la base es
// `publico.registrar_consulta_whatsapp` (FR-025).

// Respuestas de `publico.registrar_consulta_whatsapp`. `limite` y `error` no se le muestran a nadie:
// el enlace de WhatsApp se abre igual.
export type EstadoRegistroWhatsapp = 'ok' | 'limite' | 'error'

// Semilla de la sesión del navegador (solo se usa si no hay Web Crypto): reparte las claves entre
// visitantes. La clave NO es un secreto (es la clave de idempotencia de la apertura), pero tiene que
// ser única: la base deduplica por (empresa, clave_envio), así si dos visitantes compartieran clave,
// el segundo vería su consulta descartada en silencio (la RPC responde `ok` y no llega nada a la
// bandeja).
const semillaSesion = (Date.now() ^ Math.floor(Math.random() * 0x100000000)) >>> 0

// Contador del último recurso (sin Web Crypto): garantiza claves distintas aunque dos aperturas
// caigan en el mismo milisegundo.
let contadorClaves = 0

// Formatea 16 bytes como uuid v4 (la base valida el formato de la clave).
function uuidDesdeBytes(bytes: Uint8Array): string {
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// Una `clave_envio` por apertura (idempotencia del lado de la base, FR-004): dos intentos de la MISMA
// apertura no registran dos consultas; dos aperturas distintas sí.
export function nuevaClaveEnvioWhatsapp(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // La tienda abierta por http sin TLS es un contexto no seguro: ahí `crypto.randomUUID` no existe y
  // la llamada lanzaría dentro del diálogo (la visitoría se quedaría sin botón). `getRandomValues` sí
  // está en contextos no seguros, así que se arma un uuid v4 con entropía real: dos aperturas nunca
  // comparten clave (la base valida el formato uuid).
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    return uuidDesdeBytes(crypto.getRandomValues(new Uint8Array(16)))
  }
  // Último recurso (entorno sin Web Crypto): se mezclan la semilla de la sesión (hora + `Math.random`),
  // el contador de aperturas y un `Math.random` fresco. No es entropía criptográfica, pero reparte las
  // claves entre visitantes: con un contador solo, todas las sesiones compartían la primera clave y
  // el segundo visitante perdía su consulta.
  contadorClaves += 1
  const bytes = new Uint8Array(16)
  const vista = new DataView(bytes.buffer)
  vista.setUint32(0, semillaSesion)
  vista.setUint32(4, (semillaSesion ^ Math.imul(contadorClaves, 0x9e3779b1)) >>> 0)
  vista.setUint32(8, (semillaSesion + Math.imul(contadorClaves, 0x85ebca6b)) >>> 0)
  vista.setUint32(12, Math.floor(Math.random() * 0x100000000) >>> 0)
  return uuidDesdeBytes(bytes)
}

// Registra la consulta. Nunca lanza: un corte de red o un error del servidor vuelven como `error` y se
// anotan en la consola, sin detalles técnicos para el visitante.
export async function registrarConsultaWhatsapp(
  host: string,
  producto: string,
  claveEnvio: string,
): Promise<EstadoRegistroWhatsapp> {
  if (!esIdValido(producto)) {
    console.error('No se pudo registrar la consulta de WhatsApp: el producto no es un identificador válido')
    return 'error'
  }
  try {
    const { data, error } = await supabaseClient.schema('publico').rpc('registrar_consulta_whatsapp', {
      host,
      producto,
      clave_envio: claveEnvio,
    })
    if (error) {
      console.error('No se pudo registrar la consulta de WhatsApp', error.message)
      return 'error'
    }
    const estado = (data as { estado?: string } | null)?.estado
    return estado === 'ok' || estado === 'limite' ? estado : 'error'
  } catch (excepcion) {
    console.error('No se pudo registrar la consulta de WhatsApp', excepcion instanceof Error ? excepcion.message : excepcion)
    return 'error'
  }
}
