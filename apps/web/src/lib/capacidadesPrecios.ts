import type { SupabaseClient } from '@supabase/supabase-js'
import type { NivelSeccion } from './permisos'

// MSF-363 (decisiones 14 y 15). Lo que la pantalla necesita para ocultar o deshabilitar con motivo las promociones y
// «Actualizar precios»: las banderas de apagado del entorno (`public.banderas_plataforma`, apagadas por defecto) y el
// nivel de `productos` POR TIENDA. Solo informa a la UI: la autoridad son las RPC y RLS (migración 20270228300300).

export type CapacidadesPrecios = {
  // Bandera `promociones_precio`: promociones visibles y aplicadas.
  promociones: boolean
  // Bandera `precios_masivos`: «Actualizar precios».
  preciosMasivos: boolean
  // `productos` en edición en TODAS las tiendas activas de la organización (regla de los precios masivos).
  edicionEnTodasLasTiendas: boolean
  // empresa_id -> nivel de `productos` en esa tienda (solo las accesibles).
  nivelesProductos: Readonly<Record<string, NivelSeccion>>
}

// Fallo cerrado: sin saber, todo apagado y sin permiso por tienda.
export const CAPACIDADES_APAGADAS: CapacidadesPrecios = {
  promociones: false,
  preciosMasivos: false,
  edicionEnTodasLasTiendas: false,
  nivelesProductos: {},
}

export const MOTIVO_PROMOCIONES_APAGADAS = 'Las promociones de precio están desactivadas en este entorno. Pedile al equipo técnico que las active.'
export const MOTIVO_PRECIOS_MASIVOS_APAGADOS = 'La actualización masiva de precios está desactivada en este entorno. Pedile al equipo técnico que la active.'
export const MOTIVO_PRECIOS_MASIVOS_SIN_TIENDAS = 'Para actualizar precios necesitás permiso de edición de productos en todas las tiendas.'

const NIVELES: readonly NivelSeccion[] = ['edicion', 'lectura', 'ninguno']

export async function leerCapacidadesPrecios(cliente: Pick<SupabaseClient, 'rpc'>): Promise<CapacidadesPrecios> {
  const { data, error } = await cliente.rpc('capacidades_precios')
  if (error) throw error
  const d = (data ?? {}) as Record<string, unknown>
  const crudos = (d.niveles_productos && typeof d.niveles_productos === 'object' ? d.niveles_productos : {}) as Record<string, unknown>
  const niveles: Record<string, NivelSeccion> = {}
  for (const [empresa, nivel] of Object.entries(crudos)) {
    niveles[empresa] = NIVELES.includes(nivel as NivelSeccion) ? (nivel as NivelSeccion) : 'ninguno'
  }
  return {
    promociones: d.promociones === true,
    preciosMasivos: d.precios_masivos === true,
    edicionEnTodasLasTiendas: d.edicion_en_todas_las_tiendas === true,
    nivelesProductos: niveles,
  }
}
