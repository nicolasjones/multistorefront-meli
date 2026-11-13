// Adaptador de las RPC de la cola a `Deps['datos']` (sin importar Deno ni supabase-js: se prueba con `node --test`).
// `index.ts` le pasa el cliente real. La clave de servicio vive solo en esa función (servidor) y solo llama a las RPC
// del aviso, que son exclusivas de service_role.
import type { Deps, Tomado } from './handler.ts'

type Rpc = { rpc(nombre: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> }

/** Cliente de prueba para la sonda: no coincide con ningún cliente real, por lo que el cierre no toca ninguna fila. */
const CLIENTE_SONDA = '00000000-0000-0000-0000-000000000000'

export function crearDatos(cliente: Rpc): { datos: Deps['datos']; sonda: NonNullable<Deps['sonda']> } {
  const datos: Deps['datos'] = {
    pendientes: async (tope, limite) => {
      const { data, error } = await cliente.rpc('faltantes_avisos_pendientes', { p_tope: tope, p_limite: limite })
      return { data: data as string[] | null, error }
    },
    tomar: async (clienteId, tope) => {
      const { data, error } = await cliente.rpc('tomar_aviso_faltante', { p_cliente: clienteId, p_tope: tope })
      return { data: data as Tomado[] | null, error }
    },
    cerrar: async (clienteId, enviado, codigo, tope, tanda) => {
      const { data, error } = await cliente.rpc('cerrar_aviso_faltante', {
        p_cliente: clienteId, p_enviado: enviado, p_error: codigo, p_tope: tope, p_tanda: tanda,
      })
      return { data, error }
    },
  }
  // Llama al cierre con `p_tanda` sobre un cliente inexistente: si la función con ese parámetro no existe (base sin migrar)
  // devuelve error; si existe, no hace nada.
  const sonda: NonNullable<Deps['sonda']> = async () => {
    const { data, error } = await cliente.rpc('cerrar_aviso_faltante', {
      p_cliente: CLIENTE_SONDA, p_enviado: false, p_error: null, p_tope: 1, p_tanda: CLIENTE_SONDA,
    })
    return { data, error }
  }
  return { datos, sonda }
}
