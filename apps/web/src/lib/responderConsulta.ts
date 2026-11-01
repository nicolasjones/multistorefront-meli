// «Responder por…» desde el detalle de una consulta (F-CON-04, épica MSF-130). El panel NO envía nada:
// arma el enlace al cliente externo (WhatsApp o correo) y registra en la base que la consulta quedó En curso
// con responsable, reusando `public.actualizar_consulta` de MSF-122 (sin migración nueva).
import { supabaseClient } from './supabase'
import {
  ETIQUETA_ESTADO_CONSULTA,
  actualizarConsulta,
  type Consulta,
  type EstadoConsulta,
} from './consultas'
import { armarTextoInicial } from './textoInicialConsulta'

export type EnlaceRespuesta = { via: 'correo' | 'WhatsApp'; href: string }

// El contacto lo escribió el visitante: el correo va codificado entero en el `mailto:` (así un `?bcc=…`
// queda como texto del destinatario), el teléfono se reduce a dígitos para `wa.me` y todo valor del
// texto inicial va codificado. Un contacto que no es ni correo ni teléfono no ofrece enlace.
export function enlaceRespuesta(
  consulta: Pick<Consulta, 'contacto' | 'nombre' | 'empresa_nombre' | 'producto_nombre'>,
): EnlaceRespuesta | null {
  const contacto = consulta.contacto.trim()
  const texto = armarTextoInicial(consulta)
  if (contacto.includes('@')) {
    const asunto = encodeURIComponent(texto.asunto)
    const cuerpo = encodeURIComponent(texto.cuerpo)
    return { via: 'correo', href: `mailto:${encodeURIComponent(contacto)}?subject=${asunto}&body=${cuerpo}` }
  }
  const digitos = contacto.replace(/\D/g, '')
  if (digitos.length >= 7 && digitos.length <= 15) {
    return { via: 'WhatsApp', href: `https://wa.me/${digitos}?text=${encodeURIComponent(texto.cuerpo)}` }
  }
  return null
}

// Lo que cambia al responder (FR-010), calculado sobre lo que la persona tiene en el formulario:
// `nueva` pasa a `en_curso` (`en_curso` y `resuelta` conservan el actual, no se reabre) y el
// usuario actual queda de responsable solo si no había ninguno.
export function cambiosAlResponder(
  actual: { estado: EstadoConsulta; responsableId: string | null },
  usuarioId: string,
): { estado: EstadoConsulta; responsableId: string | null } {
  return {
    estado: actual.estado === 'nueva' ? 'en_curso' : actual.estado,
    responsableId: actual.responsableId ?? usuarioId,
  }
}

// Aviso de éxito (FR-013): dice cómo quedó la consulta, nunca que el mensaje salió.
export function avisoRespuestaRegistrada(
  cambios: { estado: EstadoConsulta; responsableId: string | null },
  datos: { nombreConsulta: string; nombreResponsable: string | null },
  usuarioId: string,
): string {
  const estadoTexto = ETIQUETA_ESTADO_CONSULTA[cambios.estado]
  const a = cambios.responsableId === usuarioId ? 'a tu nombre' : `a nombre de ${datos.nombreResponsable ?? 'otra persona'}`
  return `Consulta ${estadoTexto} ${a} · ${datos.nombreConsulta}`
}

// Registra la respuesta con lo que la persona tiene en el formulario (estado, responsable y nota)
// y el `updated_at` vigente: no con la foto leída al abrir, para no perder lo recién editado
// (MSF-698). Devuelve el id del usuario actual y los cambios aplicados, para el aviso.
// Lanza `ErrorConsulta` (40001 conflicto, 42501 permiso) o el error de red; la app externa ya se abrió.
export async function registrarRespuesta(
  consulta: Pick<Consulta, 'id' | 'updated_at'>,
  actual: { estado: EstadoConsulta; responsableId: string | null; nota: string },
): Promise<{ usuarioId: string; cambios: { estado: EstadoConsulta; responsableId: string | null } }> {
  const { data, error } = await supabaseClient.auth.getUser()
  const usuarioId = data.user?.id
  if (error || !usuarioId) throw new Error('No hay una sesión activa.')
  const cambios = cambiosAlResponder(actual, usuarioId)
  await actualizarConsulta({
    id: consulta.id,
    estado: cambios.estado,
    responsableId: cambios.responsableId,
    nota: actual.nota,
    actualizadoEn: consulta.updated_at,
  })
  return { usuarioId, cambios }
}
