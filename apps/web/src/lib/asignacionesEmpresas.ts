import { listarEmpresasSelector } from './empresaActiva'
import { supabaseClient } from './supabase'

// Asignación de empresas y rol por empresa desde Usuarios (F-ROL-07, FR-015…FR-017).
// Los seis roles por empresa (el Técnico suma desde MSF-597); `administrador` no es uno de ellos: accede a todas las empresas.
export const ROLES_POR_EMPRESA = ['operador', 'consulta', 'mostrador', 'deposito', 'administracion', 'tecnico'] as const

export type AsignacionEmpresa = { empresa_id: string; rol_id: string }
export type EmpresaAsignable = { id: string; nombre: string }
export type AsignacionDeUsuario = { userId: string; empresaId: string; empresaNombre: string; rolId: string }

// Estado del formulario: empresa → rol elegido (solo las empresas marcadas).
export type SeleccionEmpresas = Record<string, string>

export const ROL_POR_DEFECTO_EMPRESA = 'consulta'

export const seleccionAArreglo = (seleccion: SeleccionEmpresas): AsignacionEmpresa[] =>
  Object.entries(seleccion).map(([empresa_id, rol_id]) => ({ empresa_id, rol_id }))

export const seleccionDeUsuario = (asignaciones: AsignacionDeUsuario[]): SeleccionEmpresas =>
  Object.fromEntries(asignaciones.map((a) => [a.empresaId, a.rolId]))

export const seleccionesIguales = (a: SeleccionEmpresas, b: SeleccionEmpresas) => {
  const clavesA = Object.keys(a)
  return clavesA.length === Object.keys(b).length && clavesA.every((clave) => a[clave] === b[clave])
}

// El Administrador (quien asigna) recibe de empresas_para_selector todas las de su organización.
export async function listarEmpresasAsignables(): Promise<EmpresaAsignable[]> {
  const empresas = await listarEmpresasSelector()
  return empresas.filter((e) => e.id && e.nombre).map(({ id, nombre }) => ({ id, nombre }))
}

type FilaAsignacion = { user_id: string; empresa_id: string; empresa_nombre: string; rol_id: string }

export async function listarAsignaciones(): Promise<AsignacionDeUsuario[]> {
  const { data, error } = await supabaseClient.rpc('listar_empresas_usuarios')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Partial<FilaAsignacion>[])
    .filter((fila): fila is FilaAsignacion => Boolean(fila.empresa_id && fila.empresa_nombre && fila.rol_id))
    .map((fila) => ({ userId: fila.user_id, empresaId: fila.empresa_id, empresaNombre: fila.empresa_nombre, rolId: fila.rol_id }))
}

// La base valida Administrador, organización, roles y atomicidad, y registra el evento (FR-015, FR-018).
export async function asignarEmpresasUsuario(userId: string, asignaciones: AsignacionEmpresa[]): Promise<void> {
  const { error } = await supabaseClient.rpc('asignar_empresas_usuario', { p_target_user_id: userId, p_asignaciones: asignaciones })
  if (error) throw new Error(error.message)
}
