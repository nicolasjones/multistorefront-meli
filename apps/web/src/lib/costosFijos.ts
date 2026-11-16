import type { SupabaseClient } from '@supabase/supabase-js'
import { filtroEmpresa } from './ventas-reportes'

// Margen después de costos fijos (F-GAS-03, spec gastos-de-la-empresa). La autoridad es la base: la bandera y las vistas de
// `analitica` (migraciones `…_costos_fijos_bandera_y_vistas` y `…_margen_despues_costos_fijos`); acá solo se lee la bandera
// y se arman los filtros nativos del tablero.

export const BANDERA_MARGEN_COSTOS_FIJOS = 'margen_costos_fijos'

export const TEXTO_METODO_COSTOS_FIJOS =
  'Los costos fijos de cada tienda se reparten cada mes en proporción a sus ventas netas sin IVA: a cada producto le toca lo que vendió por la tasa del mes. El margen vigente de Rentabilidad no cambia.'
export const AVISO_MES_EN_CURSO = 'El mes en curso es provisorio: sus gastos y sus ventas todavía se están cargando.'

// Falla cerrada: ante cualquier duda la bandera se considera apagada (la pestaña no se muestra).
export async function leerBanderaMargenCostosFijos(cliente: SupabaseClient): Promise<boolean> {
  const { data, error } = await cliente.from('banderas_plataforma').select('activa').eq('clave', BANDERA_MARGEN_COSTOS_FIJOS).maybeSingle<{ activa: boolean }>()
  if (error) throw error
  return data?.activa === true
}

// Filtro nativo «Tienda» del tablero (el nombre de la empresa elegida; sin empresa = todas las accesibles del token).
export function urlParamsCostosFijos(empresaNombre: string | null): Record<string, string> {
  return empresaNombre ? { native_filters: `(${filtroEmpresa(empresaNombre)})` } : {}
}
