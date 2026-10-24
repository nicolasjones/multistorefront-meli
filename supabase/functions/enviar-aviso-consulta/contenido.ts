// Contenido del correo de aviso de una consulta nueva (F-CON-03, FR-013). Texto plano: nada de lo que
// escribe el visitante se interpreta como HTML ni entra en una cabecera sin sanear.
import { lineaSegura } from '../_shared/texto.ts'

export type DatosAviso = {
  empresaNombre: string
  origen: string
  nombre: string
  contacto: string
  mensaje: string | null
  productoNombre: string | null
}

const ORIGEN: Record<string, string> = { formulario: 'Formulario de contacto', whatsapp: 'WhatsApp' }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Enlace al detalle de la consulta. Solo lleva el id: ningún dato personal. */
export function enlaceConsulta(panelUrl: string, consultaId: string): string {
  if (!UUID.test(consultaId)) throw new Error('Id de consulta inválido')
  return `${panelUrl.trim().replace(/\/+$/, '')}/consultas?consulta=${consultaId.toLowerCase()}`
}

export function asuntoAviso(empresaNombre: string): string {
  return lineaSegura(`Nueva consulta · ${empresaNombre}`)
}

export function cuerpoAviso(datos: DatosAviso, enlace: string): string {
  const mensaje = datos.mensaje?.trim() ? datos.mensaje.trim() : 'No dejó mensaje.'
  return [
    `Llegó una consulta nueva a ${lineaSegura(datos.empresaNombre)}.`,
    '',
    `Origen: ${ORIGEN[datos.origen] ?? lineaSegura(datos.origen)}`,
    `Nombre: ${lineaSegura(datos.nombre)}`,
    `Contacto: ${lineaSegura(datos.contacto)}`,
    `Producto de interés: ${datos.productoNombre ? lineaSegura(datos.productoNombre) : 'Ninguno'}`,
    '',
    'Mensaje:',
    mensaje,
    '',
    `Abrila en el panel: ${enlace}`,
    '',
  ].join('\n')
}
