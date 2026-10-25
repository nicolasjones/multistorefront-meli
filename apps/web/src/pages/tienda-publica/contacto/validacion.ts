// F-TDA-16 (FR-008, D7): reglas por campo del formulario de contacto. Espejo EXACTO de
// private.validar_contacto_tienda (migración 20261210140000_tienda_contacto.sql): si cambia una regla, cambia en
// los dos lugares. El servidor vuelve a validar siempre.

export const MAX_NOMBRE = 100
export const MAX_CONTACTO = 120
export const MAX_MENSAJE = 2000
// Dígitos de un teléfono: 8 como mínimo (D7) y 15 como máximo (tope de la bandeja de Consultas, F-CON-01).
export const MIN_DIGITOS_TELEFONO = 8
export const MAX_DIGITOS_TELEFONO = 15

export type CampoContacto = 'nombre' | 'contacto' | 'mensaje'
export type DatosContacto = Record<CampoContacto, string>
export type ErroresContacto = Partial<Record<CampoContacto, string>>

const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/
const TELEFONO = /^\+?[0-9 ()-]+$/

function esContactoValido(contacto: string): boolean {
  if (CORREO.test(contacto)) return true
  if (!TELEFONO.test(contacto)) return false
  const digitos = contacto.replace(/[^0-9]/g, '').length
  return digitos >= MIN_DIGITOS_TELEFONO && digitos <= MAX_DIGITOS_TELEFONO
}

// Los textos se recortan antes de validar y de enviar. Devuelve un mensaje por campo inválido.
export function validarContacto(datos: DatosContacto): ErroresContacto {
  const nombre = datos.nombre.trim()
  const contacto = datos.contacto.trim()
  const mensaje = datos.mensaje.trim()
  const errores: ErroresContacto = {}
  if (nombre === '') errores.nombre = 'Escribí tu nombre.'
  else if (nombre.length > MAX_NOMBRE) errores.nombre = `El nombre admite hasta ${MAX_NOMBRE} caracteres.`
  if (contacto === '') errores.contacto = 'Dejanos un correo o un WhatsApp para responderte.'
  else if (contacto.length > MAX_CONTACTO) errores.contacto = `Admite hasta ${MAX_CONTACTO} caracteres.`
  else if (!esContactoValido(contacto)) errores.contacto = 'Ingresá un correo válido o un teléfono de entre 8 y 15 dígitos.'
  if (mensaje === '') errores.mensaje = 'Escribí tu mensaje.'
  else if (mensaje.length > MAX_MENSAJE) errores.mensaje = `El mensaje admite hasta ${MAX_MENSAJE} caracteres.`
  return errores
}

// Mensaje de un campo que el servidor marcó como inválido y el cliente no detectó.
export const MENSAJE_CAMPO_SERVIDOR: Record<CampoContacto, string> = {
  nombre: 'Revisá tu nombre.',
  contacto: 'Revisá el correo o el WhatsApp.',
  mensaje: 'Revisá tu mensaje.',
}

export const ORDEN_CAMPOS: CampoContacto[] = ['nombre', 'contacto', 'mensaje']
