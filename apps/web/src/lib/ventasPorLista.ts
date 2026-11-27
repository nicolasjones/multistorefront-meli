import type { SupabaseClient } from '@supabase/supabase-js'
import { mensajeDeErrorBase } from './mensajeErrorBase'

// Ventas por lista de precios (MSF-975, migración 20270512000500): `public.ventas_por_lista_precios` agrupa las líneas facturadas del
// período por la lista que fijó su precio (snapshot de la línea). Acá solo se lee y se muestra; el cálculo vive en la base.

export type FilaVentasPorLista = {
  // null = las líneas que no rigieron por una lista.
  listaId: string | null
  listaNombre: string | null
  // Porcentaje actual de la lista (puede haber cambiado desde la venta); null en la fila sin lista.
  ajustePctActual: number | null
  comprobantes: number
  unidades: number
  ventasNetas: number
  // Estimación frente al precio central: negativo = descuento otorgado, positivo = recargo.
  ajusteOtorgado: number
}

type Fila = {
  lista_id: string | null
  lista_nombre: string | null
  ajuste_pct_actual: number | string | null
  comprobantes: number | string
  unidades: number | string
  ventas_netas: number | string
  ajuste_otorgado: number | string
}

export async function leerVentasPorLista(
  cliente: SupabaseClient,
  { desde, hasta, empresaId }: { desde: string; hasta: string; empresaId: string | null },
): Promise<FilaVentasPorLista[]> {
  const { data, error } = await cliente.rpc('ventas_por_lista_precios', { p_desde: desde, p_hasta: hasta, p_empresa_id: empresaId })
  if (error) throw error
  return ((data ?? []) as Fila[]).map((fila) => ({
    listaId: fila.lista_id,
    listaNombre: fila.lista_nombre,
    ajustePctActual: fila.ajuste_pct_actual === null ? null : Number(fila.ajuste_pct_actual),
    comprobantes: Number(fila.comprobantes),
    unidades: Number(fila.unidades),
    ventasNetas: Number(fila.ventas_netas),
    ajusteOtorgado: Number(fila.ajuste_otorgado),
  }))
}

export const NOTA_VENTAS_POR_LISTA =
  'Ventas sin IVA: las facturas suman y las notas de crédito restan. El ajuste es una estimación frente al precio central, con el porcentaje que tenía la lista al vender; no incluye promociones ni precios manuales. El margen por lista no se calcula porque la venta no guarda el costo de ese momento.'

export function mensajeErrorVentasPorLista(error: unknown): string {
  return mensajeDeErrorBase(error, 'No pudimos cargar las ventas por lista de precios.', {
    '42501': 'Tu rol no puede ver las ventas por lista de precios.',
    '22023': 'Revisá el período elegido: Desde no puede ser posterior a Hasta y el máximo es de 5 años.',
  })
}
