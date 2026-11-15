// Respuestas rápidas por empresa (F-CON-06, MSF-274, épica MSF-144). La tabla, la vista y las RPC viven
// en las migraciones 20270201200000 y 20270201200100; acá se leen, se escriben por RPC y se resuelven
// sus variables. La autoridad es la base (RLS + RPC con sección `consultas`).
import { supabaseClient } from './supabase'
import type { Consulta } from './consultas'

export const TITULO_RESPUESTA_MAXIMO = 80
export const TEXTO_RESPUESTA_MAXIMO = 1000

export type RespuestaRapida = {
  id: string
  empresa_id: string
  titulo: string
  texto: string
  created_at: string
  updated_at: string
}

export const VARIABLES_RESPUESTA = ['{nombre}', '{tienda}', '{producto}'] as const

// Reemplaza `{nombre}`, `{tienda}` y `{producto}` con los datos de la consulta, en una sola pasada (un
// valor que trae «{tienda}» no se vuelve a expandir). Una variable sin valor queda vacía: sin llaves, sin
// espacios dobles ni espacio antes de la puntuación. Una variable desconocida se deja tal cual.
export function resolverVariables(
  texto: string,
  consulta: Pick<Consulta, 'nombre' | 'empresa_nombre' | 'producto_nombre'>,
): string {
  const valores: Record<string, string> = {
    nombre: consulta.nombre.trim(),
    tienda: consulta.empresa_nombre.trim(),
    producto: (consulta.producto_nombre ?? '').trim(),
  }
  return texto
    .replace(/\{(nombre|tienda|producto)\}/g, (_, clave: string) => valores[clave] ?? '')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .trim()
}

export class ErrorRespuestaRapida extends Error {
  readonly codigo: string | null
  constructor(mensaje: string, codigo: string | null) {
    super(mensaje)
    this.name = 'ErrorRespuestaRapida'
    this.codigo = codigo
  }
}

// Mensaje para la persona: nunca el texto crudo de la base.
export function mensajeDeErrorRespuesta(error: unknown, porDefecto: string): string {
  if (error instanceof ErrorRespuestaRapida) {
    if (error.codigo === '42501') return 'No tenés permiso para editar las respuestas rápidas de esta empresa.'
    if (error.codigo === '22023') return 'Revisá el título y el texto: son obligatorios y tienen un largo máximo.'
  }
  return porDefecto
}

const COLUMNAS = 'id, empresa_id, titulo, texto, created_at, updated_at'

export async function listarRespuestasRapidas(empresaId: string): Promise<RespuestaRapida[]> {
  const { data, error } = await supabaseClient
    .from('respuestas_rapidas_lista')
    .select(COLUMNAS)
    .eq('empresa_id', empresaId)
    .order('titulo', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw new ErrorRespuestaRapida(error.message ?? 'Error desconocido', error.code ?? null)
  return (data ?? []) as RespuestaRapida[]
}

export async function guardarRespuestaRapida(datos: {
  id: string | null
  empresaId: string
  titulo: string
  texto: string
}): Promise<string> {
  const { data, error } = await supabaseClient.rpc('guardar_respuesta_rapida', {
    p_id: datos.id,
    p_empresa_id: datos.empresaId,
    p_titulo: datos.titulo,
    p_texto: datos.texto,
  })
  if (error) throw new ErrorRespuestaRapida(error.message ?? 'Error desconocido', error.code ?? null)
  return data as string
}

export async function eliminarRespuestaRapida(id: string): Promise<void> {
  const { error } = await supabaseClient.rpc('eliminar_respuesta_rapida', { p_id: id })
  if (error) throw new ErrorRespuestaRapida(error.message ?? 'Error desconocido', error.code ?? null)
}
