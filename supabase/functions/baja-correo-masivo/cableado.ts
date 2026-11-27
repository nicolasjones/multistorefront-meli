// Cableado de `baja-correo-masivo` con dependencias inyectables (cableado.test.ts): el cliente de servicio y la lectura del entorno entran por parámetro y
// `index.ts` solo pasa los reales. Sin la URL o la clave de servicio no se puede contar el cupo: el pedido se rechaza con 503 (falla cerrado).
import { saltosDeProxy } from '../_shared/ip-cliente.ts'
import { crearConsumirCupoBaja, TEXTO_CUPO_NO_VERIFICABLE } from './cupo.ts'
import type { Deps } from './handler.ts'

type Cliente = { rpc(nombre: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> }

export function armarDepsDesdeEntorno({ env, crearCliente }: {
  env: (clave: string) => string | undefined
  crearCliente: (url: string, claveDeServicio: string) => Cliente
}): Deps {
  const saltosProxy = saltosDeProxy(env('BAJA_PROXY_SALTOS'))
  let cliente: Cliente | null = null
  try {
    const url = env('SUPABASE_URL')
    const clave = env('SUPABASE_SERVICE_ROLE_KEY')
    if (url && clave) cliente = crearCliente(url, clave)
  } catch {
    cliente = null
  }
  if (!cliente) {
    console.error('baja-correo-masivo: falta la configuración del cliente de servicio')
    return {
      saltosProxy,
      admin: { rpc: async () => ({ data: null, error: { message: 'sin cliente de servicio' } }) },
      cupo: async () => ({ status: 503, error: TEXTO_CUPO_NO_VERIFICABLE }),
    }
  }
  const activo = cliente
  const rpc = async (nombre: string, args: Record<string, unknown>) => {
    const { data, error } = await activo.rpc(nombre, args)
    return { data, error: error as { message: string; code?: string } | null }
  }
  return { saltosProxy, admin: { rpc }, cupo: crearConsumirCupoBaja(rpc) }
}
