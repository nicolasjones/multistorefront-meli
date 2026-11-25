// Newsletter de la tienda (MSF-468): tipos del contrato (`specs/20270328-100000-newsletter-de-la-tienda/contracts/newsletter.md`),
// límites (los mismos que aplica la base) y textos del panel.
import { ASUNTO_MAXIMO, MENSAJE_MAXIMO } from './correoMasivo'
import { esCodigoDeConflicto, esCodigoDeEstado } from './mensajeErrorBase'
export { ASUNTO_MAXIMO, MENSAJE_MAXIMO }
export const NOMBRE_INTERNO_MAXIMO = 100

export type EstadoSuscriptor = 'pendiente' | 'confirmado' | 'baja'
export type EstadoEnvio = 'borrador' | 'enviando' | 'enviada' | 'cancelada'

export type TiendaNewsletter = { empresa_id: string; tienda: string; activo: boolean }
export type ResumenNewsletter = {
  confirmados: number
  pendientes: number
  bajas: number
  envios: number
  bandera: boolean
  tiendas: TiendaNewsletter[]
}

export type FilaSuscriptor = {
  id: string
  correo: string
  empresa_id: string
  tienda: string
  origen: string
  creado_en: string
  estado: EstadoSuscriptor
}

export type FilaEnvio = {
  id: string
  nombre_interno: string
  empresa_id: string
  tienda: string
  asunto: string
  version: number
  fecha: string
  destinatarios: number
  enviados: number
  fallidos: number
  omitidos: number
  pendientes: number
  bajas: number
  estado: EstadoEnvio
}

export type DetalleNewsletter = {
  id: string
  version: number
  empresa_id: string
  tienda: string
  nombre_interno: string
  asunto: string
  mensaje: string
  incluir_destacados: boolean
  incluir_promociones: boolean
  estado: EstadoEnvio
}

export type VistaPreviaNewsletterDatos = { confirmados: number; generado_en: string; html: string }

export const ETIQUETA_ESTADO_SUSCRIPTOR: Record<EstadoSuscriptor, string> = { pendiente: 'Pendiente', confirmado: 'Confirmado', baja: 'Baja' }
export const ETIQUETA_ESTADO_ENVIO: Record<EstadoEnvio, string> = { borrador: 'Borrador', enviando: 'Enviando', enviada: 'Enviada', cancelada: 'Cancelada' }
export const ETIQUETA_ORIGEN: Record<string, string> = { formulario: 'Formulario' }

export type DatosCampana = { nombre: string; asunto: string; mensaje: string }
export type ErroresCampana = { nombre: string | null; asunto: string | null; mensaje: string | null; tienda: string | null }

// Espejo de las reglas de `guardar_newsletter` (nombre ≤ 100, asunto ≤ 200 sin saltos de línea, mensaje ≤ 10 000, obligatorios).
export function validarCampana(datos: DatosCampana, empresaId: string | null): ErroresCampana {
  return {
    nombre: datos.nombre.trim() === '' ? 'El nombre interno es obligatorio.' : datos.nombre.length > NOMBRE_INTERNO_MAXIMO ? `El nombre admite hasta ${NOMBRE_INTERNO_MAXIMO} caracteres.` : null,
    asunto: datos.asunto.trim() === ''
      ? 'El asunto es obligatorio.'
      : datos.asunto.length > ASUNTO_MAXIMO
        ? `El asunto admite hasta ${ASUNTO_MAXIMO} caracteres.`
        : /[\r\n]/.test(datos.asunto)
          ? 'El asunto no puede tener saltos de línea.'
          : null,
    mensaje: datos.mensaje.trim() === '' ? 'El mensaje es obligatorio.' : datos.mensaje.length > MENSAJE_MAXIMO ? `El mensaje admite hasta ${MENSAJE_MAXIMO} caracteres.` : null,
    tienda: empresaId ? null : 'Elegí la tienda remitente.',
  }
}

export const campanaValida = (errores: ErroresCampana) => Object.values(errores).every((error) => error === null)

type ErrorRpc = { message?: string; code?: string; hint?: string } | null | undefined

// Mensaje para quien opera; nunca el detalle técnico de la base.
export function textoErrorNewsletter(error: ErrorRpc): string {
  if (esCodigoDeConflicto(error?.code)) return 'El borrador cambió desde otra pestaña. Recargá para ver la última versión.'
  if (esCodigoDeEstado(error?.code)) return 'El newsletter no está habilitado o este envío ya salió.'
  if (error?.code === '42501') return 'Tu rol no puede hacer esta acción.'
  if (error?.hint === 'sin_destinatarios') return 'Todavía no hay suscriptores confirmados.'
  if (error?.hint === 'tienda_apagada') return 'Activá el newsletter de la tienda antes de enviar.'
  if (error?.hint === 'sin_dominio') return 'La tienda no tiene un dominio activo para armar los enlaces.'
  if (error?.hint === 'limite') return 'Ya pediste varias pruebas en la última hora. Probá de nuevo en un rato.'
  if (error?.hint === 'sin_correo') return 'Tu usuario no tiene un correo para recibir la prueba.'
  if (error?.code === '22023' && error.message) return error.message
  return 'No pudimos completar la acción. Probá de nuevo.'
}

const formatoFecha = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Argentina/Buenos_Aires',
})
export const textoFecha = (iso: string) => {
  const fecha = new Date(iso)
  return Number.isNaN(fecha.getTime()) ? '' : formatoFecha.format(fecha)
}
export const textoDestinatarios = (n: number) => `${n} ${n === 1 ? 'suscriptor' : 'suscriptores'}`
