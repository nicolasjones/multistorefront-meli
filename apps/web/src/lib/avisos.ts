import type { SupabaseClient } from '@supabase/supabase-js'

// Avisos por correo configurables (F-NOT-01, MSF-319). La autoridad es la base: las RPC
// `listar_preferencias_aviso` y `guardar_preferencia_aviso` (migraciones 20261210120100 y
// 20261210120200) filtran por sección y escriben solo la fila del propio usuario. Acá solo se
// mapea la respuesta y los errores a mensajes claros (contracts/avisos-y-listas.md).
export type PreferenciaAviso = { tipo: string; nombre: string; activo: boolean }

export const MENSAJE_ERROR_CARGA_AVISOS = 'No pudimos cargar tus avisos.'
export const MENSAJE_ERROR_GUARDADO_AVISO = 'No pudimos guardar tu preferencia. Probá de nuevo en unos minutos.'

type ErrorRpc = { code?: string; message?: string } | null

// 42501: tipo de una sección sin acceso; 22023: tipo desconocido.
export function mensajeDeErrorAviso(error: ErrorRpc): string {
  if (error?.code === '42501') return 'No tenés acceso a este tipo de aviso, así que no se puede cambiar.'
  if (error?.code === '22023') return 'Este tipo de aviso ya no existe. Recargá la pantalla para ver la lista actual.'
  return MENSAJE_ERROR_GUARDADO_AVISO
}

export async function listarPreferenciasAviso(cliente: Pick<SupabaseClient, 'rpc'>): Promise<PreferenciaAviso[]> {
  const { data, error } = await cliente.rpc('listar_preferencias_aviso')
  if (error) throw error
  return ((data ?? []) as PreferenciaAviso[]).map((fila) => ({ tipo: fila.tipo, nombre: fila.nombre, activo: fila.activo }))
}

export async function guardarPreferenciaAviso(
  cliente: Pick<SupabaseClient, 'rpc'>,
  tipo: string,
  activo: boolean,
): Promise<{ error: ErrorRpc }> {
  const { error } = await cliente.rpc('guardar_preferencia_aviso', { p_tipo: tipo, p_activo: activo })
  return { error }
}
