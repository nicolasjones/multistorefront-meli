import { supabaseClient } from './supabase'

// MSF-468 (Newsletter de la tienda, Fase 2): suscripción y confirmación desde la tienda pública. Qué se acepta, el límite por visitante, la
// doble confirmación y los vencimientos los decide la base (migraciones 20270342000000…0200); acá solo se llama y se traduce a estados de
// pantalla. Nada de lo que devuelve la base distingue si una dirección ya existe (SC-002).

export const MAX_CORREO = 254
export type CampoNewsletter = 'correo' | 'consentimiento'
export type DatosNewsletter = { correo: string; consentimiento: boolean }
export type ErroresNewsletter = Partial<Record<CampoNewsletter, string>>

// Espejo EXACTO de private.validar_suscripcion_newsletter: una sola dirección con forma estricta: local `atom(.atom)*` (sin `%`, `!`, `|`, `/`, punto inicial, final ni doble), dominio con
// etiquetas alfanuméricas y TLD de letras ASCII (un dominio IDN entra con sus etiquetas `xn--`; el unicode directo y un TLD `xn--` se rechazan), local ≤ 64 (sin `<`, `>`, comillas, paréntesis, `\`, `:`, `,` ni `;`), recortada y en minúsculas, ≤ 254 y con la casilla marcada.
const ATOMO = "[a-z0-9'+_=&*#$?^{}~-]+"
const CORREO = new RegExp(`^${ATOMO}(\\.${ATOMO})*@([a-z0-9]([a-z0-9-]*[a-z0-9])?\\.)+[a-z]{2,}$`)
const MAX_LOCAL = 64

export function validarSuscripcion(datos: DatosNewsletter): ErroresNewsletter {
  const correo = datos.correo.trim().toLowerCase()
  const errores: ErroresNewsletter = {}
  if (correo === '') errores.correo = 'Escribí tu correo.'
  else if (correo.length > MAX_CORREO || correo.split('@')[0].length > MAX_LOCAL || !CORREO.test(correo)) errores.correo = 'Ingresá un correo válido.'
  if (!datos.consentimiento) errores.consentimiento = 'Marcá la casilla para suscribirte.'
  return errores
}

export const ORDEN_CAMPOS_NEWSLETTER: CampoNewsletter[] = ['correo', 'consentimiento']
export const MENSAJE_CAMPO_SERVIDOR_NEWSLETTER: Record<CampoNewsletter, string> = {
  correo: 'Revisá el correo.',
  consentimiento: 'Marcá la casilla para suscribirte.',
}

export type NewsletterTienda = { activo: boolean; tienda: string | null }

// publico.newsletter_por_dominio es ejecutable por anon. Cualquier falla se trata como «no mostrar el formulario».
export async function leerNewsletterTienda(host: string): Promise<NewsletterTienda> {
  const { data, error } = await supabaseClient.schema('publico').rpc('newsletter_por_dominio', { p_host: host })
  if (error) throw new Error(error.message)
  const fila = (data ?? {}) as { activo?: boolean; tienda?: string | null }
  return fila.activo === true && typeof fila.tienda === 'string' ? { activo: true, tienda: fila.tienda } : { activo: false, tienda: null }
}

export type ResultadoSuscripcion =
  | { estado: 'exito' }
  | { estado: 'invalido'; campos: CampoNewsletter[] }
  | { estado: 'espera'; esperaSegundos: number }
  | { estado: 'falla' }

type RespuestaSuscripcion = { resultado?: string; campos?: string[]; espera_segundos?: number }

// Una clave por intento (idempotencia): «Reintentar» reutiliza la misma; un correo distinto pide una nueva.
export function nuevaClaveNewsletter(): string {
  return crypto.randomUUID()
}

export function traducirRespuestaSuscripcion(respuesta: RespuestaSuscripcion | null | undefined): ResultadoSuscripcion {
  switch (respuesta?.resultado) {
    case 'ok':
      return { estado: 'exito' }
    case 'invalido':
      return { estado: 'invalido', campos: ORDEN_CAMPOS_NEWSLETTER.filter((campo) => respuesta.campos?.includes(campo)) }
    case 'limite':
      return { estado: 'espera', esperaSegundos: Math.max(1, Math.round(respuesta.espera_segundos ?? 60)) }
    default:
      return { estado: 'falla' }
  }
}

// Un corte de red o un error del servidor se traducen a `falla`: nunca se muestra el detalle técnico ni se registra el correo.
export async function suscribirseNewsletter(host: string, datos: DatosNewsletter, clave: string, trampa: string): Promise<ResultadoSuscripcion> {
  try {
    const { data, error } = await supabaseClient.schema('publico').rpc('suscribirse_newsletter', {
      p_host: host,
      p_correo: datos.correo.trim(),
      p_consentimiento: datos.consentimiento,
      p_clave: clave,
      p_trampa: trampa,
    })
    if (error) {
      console.error('No se pudo registrar la suscripción al newsletter', error.message)
      return { estado: 'falla' }
    }
    return traducirRespuestaSuscripcion(data as RespuestaSuscripcion | null)
  } catch (excepcion) {
    console.error('No se pudo registrar la suscripción al newsletter', excepcion instanceof Error ? excepcion.message : excepcion)
    return { estado: 'falla' }
  }
}

export type ResultadoConfirmacion = 'ok' | 'vencido' | 'invalido' | 'espera' | 'falla'

// Forma del token del correo (64 hexadecimales): lo que no la cumple ni se envía.
export const FORMA_TOKEN_NEWSLETTER = /^[0-9a-f]{64}$/

export async function confirmarNewsletter(host: string, token: string): Promise<ResultadoConfirmacion> {
  if (!FORMA_TOKEN_NEWSLETTER.test(token)) return 'invalido'
  try {
    const { data, error } = await supabaseClient.schema('publico').rpc('confirmar_newsletter', { p_host: host, p_token: token })
    if (error) {
      console.error('No se pudo confirmar la suscripción al newsletter', error.message)
      return 'falla'
    }
    switch ((data as { resultado?: string } | null)?.resultado) {
      case 'ok':
        return 'ok'
      case 'vencido':
        return 'vencido'
      case 'invalido':
        return 'invalido'
      case 'limite':
        return 'espera'
      default:
        return 'falla'
    }
  } catch (excepcion) {
    console.error('No se pudo confirmar la suscripción al newsletter', excepcion instanceof Error ? excepcion.message : excepcion)
    return 'falla'
  }
}
