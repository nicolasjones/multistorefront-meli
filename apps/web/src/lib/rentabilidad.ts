import type { SupabaseClient } from '@supabase/supabase-js'

// Rentabilidad (épica MSF-120, spec `rentabilidad-margen`). La autoridad es la base (migraciones
// 20261130100000 `leer_umbral_margen_bajo` / `guardar_umbral_margen_bajo` y 20261130110100
// `rentabilidad_conteo_margen`); acá se espeja SOLO el parseo del porcentaje para dar feedback mientras
// se escribe. El umbral viaja como fracción (0,10 = 10 %), la pantalla lo muestra en %.

export const SECCION_RENTABILIDAD = 'rentabilidad'
export const RUTA_RENTABILIDAD = '/rentabilidad'
export const RUTA_POR_PRODUCTO = '/rentabilidad/productos'
// F-REN-03 lee este filtro al abrir «Por producto» desde el aviso del resumen (FR-015, FR-019).
export const RUTA_POR_PRODUCTO_BAJO_O_NEGATIVO = `${RUTA_POR_PRODUCTO}?estado=bajo_o_negativo`

// Nombre con el que el importador registra el tablero «Resumen» (infra/superset/dashboards/rentabilidad/reportes.json).
export const NOMBRE_REPORTE_RESUMEN = 'Rentabilidad · Resumen'

export const MENSAJE_UMBRAL_INVALIDO = 'Ingresá un porcentaje mayor a 0 y hasta 100, por ejemplo 10 o 12,5.'
export const MENSAJE_CONFLICTO_UMBRAL = 'Otra persona cambió el umbral mientras lo editabas. Cerrá el diálogo y volvé a abrirlo.'

export type UmbralMargen = {
  // Fracción: 0,10 = 10 %.
  umbral: number
  // null mientras la organización usa el valor por defecto (todavía no hay fila).
  actualizadoEn: string | null
}

// `productosConMargen` = 0 es el estado vacío del resumen (ningún producto con margen calculado).
export type ConteoMargen = { conMargenBajo: number; conMargenNegativo: number; productosConMargen: number }

type ConteoRpc = { con_margen_bajo: number | string; con_margen_negativo: number | string; productos_con_margen: number | string }

const FORMATO_PORCENTAJE = /^\d+(?:,\d{1,2})?$/
const formatoPorcentaje = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })

// El campo solo admite dígitos y coma decimal (como el resto de los campos numéricos del panel).
export const soloCaracteresDeUmbral = (texto: string) => texto.replace(/[^0-9,]/g, '')

// Texto del campo (en %) → fracción, o null si no es válido (vacío, 0, > 100, más de 2 decimales).
export function parsearUmbralPct(texto: string): number | null {
  const limpio = texto.trim()
  if (!FORMATO_PORCENTAJE.test(limpio)) return null
  const pct = Number(limpio.replace(',', '.'))
  if (!(pct > 0 && pct <= 100)) return null
  return Math.round(pct * 100) / 10_000
}

// 0,10 → «10»; 0,125 → «12,5» (valor inicial del campo del diálogo).
export const umbralATexto = (umbral: number) => formatoPorcentaje.format(Math.round(umbral * 10_000) / 100)

// «Con margen bajo (< 10 %)»
export const rotuloMargenBajo = (umbral: number) => `Con margen bajo (< ${umbralATexto(umbral)} %)`

// Mensaje claro según el código de la base; nunca el texto técnico.
export function mensajeDeErrorRentabilidad(error: { code?: string } | null | undefined): string {
  switch (error?.code) {
    case '42501': return 'Tu rol no puede cambiar el umbral de margen bajo.'
    case '23514': return MENSAJE_UMBRAL_INVALIDO
    case '40001': return MENSAJE_CONFLICTO_UMBRAL
    default: return 'No pudimos guardar el umbral. Intentá de nuevo.'
  }
}

export async function leerUmbralMargenBajo(cliente: SupabaseClient): Promise<UmbralMargen> {
  const [valor, config] = await Promise.all([
    cliente.rpc('leer_umbral_margen_bajo'),
    // `dominio` no es el esquema por defecto del cliente; RLS acota a la organización activa.
    cliente.schema('dominio').from('rentabilidad_config').select('updated_at').maybeSingle(),
  ])
  if (valor.error) throw valor.error
  if (config.error) throw config.error
  return {
    umbral: Number(valor.data),
    actualizadoEn: (config.data as { updated_at: string } | null)?.updated_at ?? null,
  }
}

export async function guardarUmbralMargenBajo(
  cliente: SupabaseClient,
  umbral: number,
  actualizadoEn: string | null,
): Promise<string> {
  const { data, error } = await cliente.rpc('guardar_umbral_margen_bajo', {
    p_umbral: umbral,
    p_updated_at: actualizadoEn,
  })
  if (error) throw error
  return data as string
}

export async function leerConteoMargen(cliente: SupabaseClient): Promise<ConteoMargen> {
  const { data, error } = await cliente.rpc('rentabilidad_conteo_margen')
  if (error) throw error
  const fila = (Array.isArray(data) ? data[0] : data) as ConteoRpc | null | undefined
  return {
    conMargenBajo: Number(fila?.con_margen_bajo ?? 0),
    conMargenNegativo: Number(fila?.con_margen_negativo ?? 0),
    productosConMargen: Number(fila?.productos_con_margen ?? 0),
  }
}

export const hayProductosEnRiesgo = (conteo: ConteoMargen) => conteo.conMargenBajo + conteo.conMargenNegativo > 0
