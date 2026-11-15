// Texto inicial de «Responder por…» (F-CON-04, FR-009). Es el ÚNICO punto que arma el mensaje: F-CON-06
// (contactos y respuestas rápidas, MSF-144) lo reemplaza sin tocar el botón ni el enlace.
import type { Consulta, ItemConsulta } from './consultas'
import { resolverVariables, type RespuestaRapida } from './respuestasRapidas'

export type TextoInicial = { asunto: string; cuerpo: string }

export function armarTextoInicial(
  consulta: Pick<Consulta, 'nombre' | 'empresa_nombre' | 'producto_nombre'> & Partial<Pick<Consulta, 'origen'>>,
  respuesta?: Pick<RespuestaRapida, 'texto'> | null,
  items?: readonly ItemConsulta[] | null,
): TextoInicial {
  // Con una respuesta rápida elegida (F-CON-06) el cuerpo es su texto con las variables resueltas;
  // sin ella, la plantilla fija de F-CON-04. El asunto no cambia.
  if (respuesta) {
    return {
      asunto: `Tu consulta en ${consulta.empresa_nombre}`,
      cuerpo: resolverVariables(respuesta.texto, consulta),
    }
  }
  const nombre = consulta.nombre.trim()
  const saludo = nombre === '' ? 'Hola' : `Hola ${nombre}`
  // Un pedido (MSF-176, B1, P-6): lista los ítems y promete confirmar disponibilidad y precio (los ítems son texto de la tienda; el enlace
  // `mailto:`/`wa.me` los codifica entero). Mientras los ítems no cargaron, el texto sale sin la lista.
  if (consulta.origen === 'pedido') {
    const lineas = (items ?? []).map((item) => `• ${item.cantidad} × ${item.descripcion}${item.sku ? ` (${item.sku})` : ''}`)
    return {
      asunto: `Tu consulta en ${consulta.empresa_nombre}`,
      cuerpo: [`${saludo}, recibimos tu pedido:`, ...lineas, 'Te escribimos para confirmar disponibilidad y precio.'].join('\n'),
    }
  }
  const producto = consulta.producto_nombre?.trim()
  const motivo = producto ? ` por ${producto}` : ''
  return {
    asunto: `Tu consulta en ${consulta.empresa_nombre}`,
    cuerpo: `${saludo}, te escribimos de ${consulta.empresa_nombre} por tu consulta${motivo}. `,
  }
}
