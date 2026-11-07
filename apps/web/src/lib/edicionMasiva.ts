// Edición masiva de productos (F-CAT-12, MSF-392). Tres RPC atómicas e idempotentes (`security invoker`,
// de 1 a 100 ids) que devuelven cuántos productos cambiaron de verdad; la pantalla manda como mucho una
// página (25). La autoridad es la base: acá solo se llaman y se traducen sus errores.
import type { SupabaseClient } from '@supabase/supabase-js'

export const MENSAJE_SIN_CAMBIOS = 'No hubo cambios'

type ClienteRpc = Pick<SupabaseClient, 'rpc'>

async function llamar(cliente: ClienteRpc, funcion: string, argumentos: Record<string, unknown>): Promise<number> {
  const { data, error } = await cliente.rpc(funcion, argumentos)
  if (error) throw error
  return Number(data ?? 0)
}

export const moverProductosCategoria = (cliente: ClienteRpc, ids: readonly string[], categoriaId: string) =>
  llamar(cliente, 'mover_productos_categoria', { p_producto_ids: [...ids], p_categoria_id: categoriaId })

export const cambiarEstadoProductos = (cliente: ClienteRpc, ids: readonly string[], activo: boolean) =>
  llamar(cliente, 'cambiar_estado_productos', { p_producto_ids: [...ids], p_activo: activo })

export const definirEmpresasProductos = (
  cliente: ClienteRpc,
  ids: readonly string[],
  agregar: readonly string[],
  quitar: readonly string[],
) => llamar(cliente, 'definir_empresas_productos', { p_producto_ids: [...ids], p_agregar: [...agregar], p_quitar: [...quitar] })

export const productosN = (cantidad: number) => `${cantidad} ${cantidad === 1 ? 'producto' : 'productos'}`

// «N productos movidos a Joysticks», «N productos activados»… o «No hubo cambios» si la base no cambió ninguno.
export function avisoResultado(cambiados: number, accion: { singular: string; plural: string }, destino?: string): string {
  if (cambiados === 0) return MENSAJE_SIN_CAMBIOS
  const texto = `${productosN(cambiados)} ${cambiados === 1 ? accion.singular : accion.plural}`
  return destino ? `${texto} a ${destino}` : texto
}

// Mensaje claro para el error de la base; el detalle técnico va a la consola, nunca a la pantalla.
export function mensajeErrorEdicionMasiva(error: unknown): string {
  console.error('No pudimos aplicar el cambio a los productos.', error)
  const code = (error as { code?: string } | null)?.code
  if (code === '42501') return 'No tenés permiso para editar productos. Puede que tu rol haya cambiado: recargá la página.'
  if (code === 'P0002') return 'Alguno de los productos o la categoría ya no existe. Recargá la lista e intentá de nuevo; no se cambió ningún producto.'
  if (code === '22023') return 'Algún dato no es válido. No se cambió ningún producto.'
  return 'No pudimos aplicar el cambio. No se cambió ningún producto: intentá de nuevo.'
}
