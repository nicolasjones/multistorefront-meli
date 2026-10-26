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

// Contador del último recurso (sin Web Crypto): garantiza claves distintas aunque dos aperturas
// caigan en el mismo milisegundo.
let contadorClaves = 0

// Una `clave_envio` por apertura (idempotencia del lado de la base, FR-004): dos intentos de la MISMA
// apertura no registran dos consultas; dos aperturas distintas sí.
export function nuevaClaveEnvioWhatsapp(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // La tienda abierta por http sin TLS es un contexto no seguro: ahí `crypto.randomUUID` no existe y
  // la llamada lanzaría dentro del diálogo (la visitoría se quedaría sin botón). `getRandomValues` sí
  // está en contextos no seguros, así que se arma un uuid v4 con entropía real: dos aperturas nunca
  // comparten clave (la base valida el formato uuid).
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  // Último recurso (entorno sin Web Crypto): la clave no es un secreto, pero tiene que ser única.
  contadorClaves += 1
  return `00000000-0000-4000-8000-${String(contadorClaves).padStart(12, '0').slice(-12)}`
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
