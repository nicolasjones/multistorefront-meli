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

// Una `clave_envio` por apertura (idempotencia del lado de la base, FR-004): dos intentos de la MISMA
// apertura no registran dos consultas; dos aperturas distintas sí.
export function nuevaClaveEnvioWhatsapp(): string {
  return crypto.randomUUID()
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
