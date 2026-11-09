import type { SupabaseClient } from '@supabase/supabase-js'
import { type Moneda, parsearImporte } from './productos'

// Precio propio de un producto en una empresa (F-PRE-08, FR-013…FR-019). La autoridad es la base
// (`dominio.precios_propios_empresa`, `public.fijar_precio_propio`, `public.quitar_precio_propio`,
// `public.leer_precios_propios`): acá solo se valida el texto antes de llamar y se traducen los errores.
// Los precios propios no se envían a Mercado Libre (Etapa 2, FR-020).
//
// Fuera de alcance (FR-019, Decisión abierta 4): el listado de productos no tiene hoy columna de precio por
// empresa, así que la marca «Precio propio» vive solo en la ficha (y en el simulador, F-PRE-09).

export const MARCA_PRECIO_PROPIO = 'Precio propio'
export const TEXTO_PRECIO_PROPIO =
  'Fija un precio distinto para una empresa. Reemplaza al central con ajuste; el IVA de la empresa se aplica encima.'

export type PrecioPropio = { empresaId: string; moneda: Moneda; importe: number }

type FilaPrecioPropio = { empresa_id: string; moneda: Moneda; importe: number | string }

export async function leerPreciosPropios(cliente: Pick<SupabaseClient, 'rpc'>, productoId: string): Promise<PrecioPropio[]> {
  const { data, error } = await cliente.rpc('leer_precios_propios', { p_producto: productoId })
  if (error) throw error
  return (Array.isArray(data) ? (data as FilaPrecioPropio[]) : []).map((fila) => ({
    empresaId: fila.empresa_id,
    moneda: fila.moneda,
    importe: Number(fila.importe),
  }))
}

// Neto sin IVA, en pesos, que hoy calcula la base para cada empresa (ejemplo junto al campo). Es informativo:
// si el rol no ve la sección Empresas o la lectura falla, no hay ejemplo y el bloque sigue funcionando.
export async function leerNetosProducto(cliente: Pick<SupabaseClient, 'from'>, productoId: string): Promise<Map<string, number | null>> {
  const { data, error } = await cliente
    .from('precios_empresa_neto')
    .select('empresa_id, neto_ars')
    .eq('producto_id', productoId)
    .returns<Array<{ empresa_id: string; neto_ars: number | string | null }>>()
  if (error) throw error
  return new Map((data ?? []).map((fila) => [fila.empresa_id, fila.neto_ars === null ? null : Number(fila.neto_ars)]))
}

export async function fijarPrecioPropio(
  cliente: Pick<SupabaseClient, 'rpc'>,
  productoId: string,
  empresaId: string,
  moneda: Moneda,
  importe: number,
): Promise<void> {
  const { error } = await cliente.rpc('fijar_precio_propio', {
    p_producto: productoId,
    p_empresa: empresaId,
    p_moneda: moneda,
    p_importe: importe,
  })
  if (error) throw error
}

export async function quitarPrecioPropio(cliente: Pick<SupabaseClient, 'rpc'>, productoId: string, empresaId: string): Promise<void> {
  const { error } = await cliente.rpc('quitar_precio_propio', { p_producto: productoId, p_empresa: empresaId })
  if (error) throw error
}

// Texto del campo → importe, o el mensaje que ve la persona (vacío, no numérico, cero, negativo o fuera de rango).
export function validarPrecioPropio(texto: string): { importe: number } | { error: string } {
  const limpio = texto.trim()
  if (limpio === '') return { error: 'Ingresá el precio propio.' }
  const importe = parsearImporte(limpio)
  if (importe === null) return { error: 'Ingresá un precio válido: solo números, hasta 12 enteros y 2 decimales.' }
  if (importe <= 0) return { error: 'El precio propio debe ser mayor que cero.' }
  return { importe }
}

// El mensaje crudo de Postgres puede nombrar tablas o políticas: al usuario va solo el texto en castellano.
export function mensajeErrorPrecioPropio(error: unknown, porDefecto = 'No pudimos guardar el precio propio. Probá de nuevo.'): string {
  const code = (error as { code?: string } | null)?.code
  if (code === '42501') return 'Tu rol no puede editar los precios propios. Puede que haya cambiado: recargá la página.'
  if (code === 'P0002') return 'El producto o la empresa ya no existe. Recargá la página.'
  if (code === '22023' || code === '23514') return 'Revisá el precio propio: mayor que cero, con hasta 2 decimales.'
  if (code === '22003') return 'El precio propio es demasiado grande.'
  return porDefecto
}

export const aTextoImporte = (importe: number) => String(importe).replace('.', ',')
