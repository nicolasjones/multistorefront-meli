// Cupo persistente por IP de `baja-correo-masivo` (MSF-980), con la RPC inyectada para probarlo con `node --test` (cupo.test.ts) sin Deno ni Supabase.
// La IP viaja a `public.consumir_cupo_baja_correo` (solo service_role), que guarda únicamente su HMAC con el secreto de Vault de cada entorno: la IP no se
// guarda ni se registra. Falla CERRADO: si la base no responde o responde algo ilegible, el pedido se rechaza con 503 (nunca se deja pasar sin contar).
import { registrarErrorDeBase, textoDeError } from '../_shared/log-seguro.ts'
import { segundosDeEspera } from '../_shared/cupo-ia.ts'

export type RechazoCupo = { status: number; error: string; retryAfter?: number }
type Rpc = (nombre: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>

export const TEXTO_CUPO_AGOTADO = 'Hiciste demasiados pedidos seguidos. Probá de nuevo en un rato.'
export const TEXTO_CUPO_NO_VERIFICABLE = 'No pudimos procesar la baja. Probá de nuevo en un rato.'
const NO_VERIFICABLE: RechazoCupo = { status: 503, error: TEXTO_CUPO_NO_VERIFICABLE }

export function crearConsumirCupoBaja(rpc: Rpc) {
  return async (ip: string): Promise<RechazoCupo | null> => {
    let data: unknown
    let error: unknown
    try {
      ;({ data, error } = await rpc('consumir_cupo_baja_correo', { p_ip: ip }))
    } catch (excepcion) {
      // Red, timeout o excepción del cliente: sin mensaje ni URL en el log (solo el nombre del error).
      console.error('baja-correo-masivo: la RPC de cupo lanzó una excepción', textoDeError(excepcion))
      return NO_VERIFICABLE
    }
    if (error) {
      registrarErrorDeBase('baja-correo-masivo: no se pudo consumir el cupo', error)
      return NO_VERIFICABLE
    }
    try {
      const fila = Array.isArray(data) ? data[0] : data
      const consumio = (fila as { se_consumio?: unknown } | null | undefined)?.se_consumio
      if (typeof consumio !== 'boolean') {
        console.error('baja-correo-masivo: respuesta del cupo no interpretable')
        return NO_VERIFICABLE
      }
      // (`consumio` ya es booleano: `if (consumio)` y `consumio !== false` son equivalentes tras la comprobación de tipo de arriba.)
      if (consumio) return null
      return { status: 429, error: TEXTO_CUPO_AGOTADO, retryAfter: segundosDeEspera((fila as { segundos_hasta_reinicio?: unknown }).segundos_hasta_reinicio) }
    } catch {
      // Una respuesta hostil (getter que lanza) tampoco puede abrir el cupo.
      console.error('baja-correo-masivo: no se pudo interpretar la respuesta del cupo')
      return NO_VERIFICABLE
    }
  }
}
