import { supabaseClient } from './supabase'

// Interés por WhatsApp (F-CON-02, FR-004/FR-005). La lectura sale de la vista
// `public.interes_whatsapp_por_producto` (security_invoker): la RLS de la base decide qué ve cada
// persona (sección `consultas` ≥ lectura y empresa accesible); acá solo se filtra por la empresa activa.

export type InteresPorProducto = {
  organizacion_id: string
  empresa_id: string
  empresa_nombre: string
  producto_id: string
  producto_nombre: string
  sku: string | null
  total: number
  ultimo_interes_at: string
}

export const MENSAJE_ERROR_INTERES = 'No pudimos cargar el interés por WhatsApp. Probá de nuevo.'

// `empresaId` null = «Todas mis empresas»: la RLS acota a las accesibles. Mayor a menor por veces y,
// a igualdad, el más reciente primero; el producto desempata para que el orden sea estable.
export async function listarInteresWhatsapp(empresaId: string | null): Promise<InteresPorProducto[]> {
  let consulta = supabaseClient
    .from('interes_whatsapp_por_producto')
    .select('organizacion_id, empresa_id, empresa_nombre, producto_id, producto_nombre, sku, total, ultimo_interes_at')
  if (empresaId) consulta = consulta.eq('empresa_id', empresaId)
  const { data, error } = await consulta
    .order('total', { ascending: false })
    .order('ultimo_interes_at', { ascending: false })
    .order('producto_nombre', { ascending: true })
    .returns<InteresPorProducto[]>()
  if (error) throw new Error(error.message)
  return (data ?? []).map((fila) => ({ ...fila, total: Number(fila.total) }))
}

// `ultimo_interes_at` es un timestamp: se muestra el día en hora de Argentina (dd/mm/aaaa).
export const formatearUltimoInteres = (iso: string) =>
  new Date(iso).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric' })

export function mensajeDeErrorInteres(error: unknown): string {
  if (error instanceof Error && error.message) {
    console.error('No se pudo leer el interés por WhatsApp', error.message)
  }
  return MENSAJE_ERROR_INTERES
}
