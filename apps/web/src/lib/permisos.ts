import { supabaseClient } from './supabase'

export type NivelSeccion = 'edicion' | 'lectura' | 'ninguno'
export type AccionPermiso = 'eliminar' | 'exportar' | 'ver_costos'

export type PermisoSeccion = {
  seccion: string
  nivel: NivelSeccion
  eliminar: boolean
  exportar: boolean
  ver_costos: boolean
}

// Recurso de Refine → sección de la matriz de permisos (F-ROL-01, FR-005).
// Solo los recursos ya existentes que corresponden a una sección del
// prototipo; cada épica de dominio agrega los suyos al crear su pantalla.
// Los recursos de plataforma (ejecuciones, conexiones, ...) no están en la
// matriz y conservan su control actual.
export const SECCION_POR_RECURSO: Readonly<Record<string, string>> = {
  clientes: 'clientes',
  miembros: 'usuarios_permisos',
}

// Espejo, solo para gatear la UI, de private.nivel_seccion/puede_accion: la
// autorización real la hace RLS en la base de datos (FR-003 de la spec).
export async function obtenerPermisosActuales(): Promise<PermisoSeccion[]> {
  const { data, error } = await supabaseClient.rpc('permisos_actuales')
  if (error) {
    throw new Error(error.message)
  }
  return (data ?? []) as PermisoSeccion[]
}

// Una sección sin fila es «ninguno»: nunca acceso total por omisión.
export function nivelDe(permisos: readonly PermisoSeccion[], seccion: string): NivelSeccion {
  return permisos.find((permiso) => permiso.seccion === seccion)?.nivel ?? 'ninguno'
}

export function puedeAccionEn(permisos: readonly PermisoSeccion[], seccion: string, accion: AccionPermiso): boolean {
  return Boolean(permisos.find((permiso) => permiso.seccion === seccion)?.[accion])
}

// list/show piden al menos lectura; cualquier otra acción de Refine
// (create, edit, delete, personalizadas) pide edición.
export function nivelPermiteAccionRefine(nivel: NivelSeccion, action: string | undefined): boolean {
  if (nivel === 'ninguno') {
    return false
  }
  return action === 'list' || action === 'show' ? true : nivel === 'edicion'
}
