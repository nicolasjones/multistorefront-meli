import { supabaseClient } from './supabase'

// Listas configurables (F-CFG-01, FR-014/FR-015): estados de consulta. Los motivos de stock
// reutilizan dominio.motivos_movimiento y su editor (pages/stock/motivos.tsx), sin RPC propia.
export const LARGO_MAXIMO_ITEM_LISTA = 80

export type EstadoConsulta = { id: string; nombre: string; activo: boolean; orden: number }

export function validarNombreItem(texto: string): string | null {
  const recortado = texto.trim()
  if (recortado === '') return 'Ingresá un nombre.'
  if (recortado.length > LARGO_MAXIMO_ITEM_LISTA) return `Máximo ${LARGO_MAXIMO_ITEM_LISTA} caracteres.`
  return null
}

// Códigos de las RPC (contracts/avisos-y-listas.md): 42501 sin permiso, 23514 vacío,
// 23505 repetido, P0002 inexistente.
export function mensajeDeErrorLista(error: unknown, porDefecto: string): string {
  console.error(porDefecto, error)
  const code = (error as { code?: string } | null)?.code
  if (code === '42501') return 'No tenés permiso para esta acción. Puede que tu rol haya cambiado: recargá la página.'
  if (code === '23514') return 'El nombre no puede estar vacío.'
  if (code === '23505') return 'Ya existe un estado con ese nombre.'
  if (code === 'P0002') return 'El estado ya no existe. Recargá la lista.'
  return porDefecto
}

export async function listarEstadosConsulta(): Promise<EstadoConsulta[]> {
  const { data, error } = await supabaseClient
    .schema('dominio')
    .from('estados_consulta')
    .select('id, nombre, activo, orden')
    .order('orden', { ascending: true })
    .returns<EstadoConsulta[]>()
  if (error) throw error
  return data ?? []
}

export async function crearEstadoConsulta(nombre: string): Promise<void> {
  const { error } = await supabaseClient.rpc('crear_estado_consulta', { p_nombre: nombre.trim() })
  if (error) throw error
}

export async function renombrarEstadoConsulta(id: string, nombre: string): Promise<void> {
  const { error } = await supabaseClient.rpc('renombrar_estado_consulta', { p_id: id, p_nombre: nombre.trim() })
  if (error) throw error
}

export async function cambiarActivoEstadoConsulta(id: string, activo: boolean): Promise<void> {
  const { error } = await supabaseClient.rpc('cambiar_estado_estado_consulta', { p_id: id, p_activo: activo })
  if (error) throw error
}
