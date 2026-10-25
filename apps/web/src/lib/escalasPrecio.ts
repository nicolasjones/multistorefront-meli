// Escalas de precio del producto (F-CAT-16, FR-004). Solo lectura: las calcula y publica Precios (F-PRE-15, MSF-114).
import type { SupabaseClient } from '@supabase/supabase-js'

export type EscalaPrecio = { clave: 'x1' | 'x5' | 'x10' | 'x50'; rango: string; precio: number | string }

// Rangos fijos de la spec (FR-004); el precio de cada escala viene de Precios.
export const ESCALAS_PRECIO: ReadonlyArray<Pick<EscalaPrecio, 'clave' | 'rango'>> = [
  { clave: 'x1', rango: '1 a 4 u.' },
  { clave: 'x5', rango: '5 a 9 u.' },
  { clave: 'x10', rango: '10 a 49 u.' },
  { clave: 'x50', rango: '50 u. o más' },
]

// PUNTO DE ENLACE ÚNICO con Precios. MSF-114 (F-PRE-15) todavía no publicó el contrato de lectura de
// escalas, y acá no se inventa: mientras tanto devuelve null y la ficha muestra «No disponible».
// Cuando se publique, solo se reemplaza el cuerpo de esta función (ver docs/catalogo.md).
export async function leerEscalasPrecio(
  _cliente: Pick<SupabaseClient, 'rpc'>,
  _productoId: string,
): Promise<EscalaPrecio[] | null> {
  return null
}
