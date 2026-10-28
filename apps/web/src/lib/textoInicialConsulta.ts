// Texto inicial de «Responder por…» (F-CON-04, FR-009). Es el ÚNICO punto que arma el mensaje: F-CON-06
// (contactos y respuestas rápidas, MSF-144) lo reemplaza sin tocar el botón ni el enlace.
import type { Consulta } from './consultas'

export type TextoInicial = { asunto: string; cuerpo: string }

export function armarTextoInicial(
  consulta: Pick<Consulta, 'nombre' | 'empresa_nombre' | 'producto_nombre'>,
): TextoInicial {
  const nombre = consulta.nombre.trim()
  const saludo = nombre === '' ? 'Hola' : `Hola ${nombre}`
  const producto = consulta.producto_nombre?.trim()
  const motivo = producto ? ` por ${producto}` : ''
  return {
    asunto: `Tu consulta en ${consulta.empresa_nombre}`,
    cuerpo: `${saludo}, te escribimos de ${consulta.empresa_nombre} por tu consulta${motivo}. `,
  }
}
