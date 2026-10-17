import { supabaseClient } from './supabase'

export type EmpresaSelector = {
  id: string
  nombre: string
  esActiva: boolean
  rolId: string | null
}

type FilaSelector = { id: string; nombre: string; es_activa: boolean; rol_id: string | null }

// Empresas que el usuario puede elegir (no todas las de la organización:
// RLS de dominio.empresas muestra más) con la activa marcada (F-ROL-06, FR-010).
export async function listarEmpresasSelector(): Promise<EmpresaSelector[]> {
  const { data, error } = await supabaseClient.rpc('empresas_para_selector')
  if (error) {
    throw new Error(error.message)
  }
  return ((data ?? []) as FilaSelector[]).map((fila) => ({
    id: fila.id,
    nombre: fila.nombre,
    esActiva: fila.es_activa,
    rolId: fila.rol_id,
  }))
}

// La base valida el acceso y registra el evento (FR-009, FR-014); acá solo se llama.
export async function cambiarEmpresaActiva(empresaId: string): Promise<void> {
  const { error } = await supabaseClient.rpc('cambiar_empresa_activa', { p_empresa_id: empresaId })
  if (error) {
    throw new Error(error.message)
  }
}
