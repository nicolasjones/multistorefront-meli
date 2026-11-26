// Cableado del cupo por usuario y hora de `enviar-correo-proveedor` (lote 91, MSF-731), con dependencias inyectables para probarlo
// con `node --test` (cupo.test.ts) sin Deno ni Supabase. `index.ts` solo pasa el cliente admin real y la lectura del entorno.
import { FUNCIONALIDAD_CORREO_PROVEEDOR, limiteDeCupo, rechazoPorCupo, type RechazoCupo } from '../_shared/cupo-ia.ts'

export const LIMITE_POR_DEFECTO = 20
export const TEXTO_CUPO_AGOTADO = 'Enviaste demasiados correos en poco tiempo. Probá de nuevo más tarde.'

type Admin = Parameters<typeof rechazoPorCupo>[0]

export function crearConsumirCupo(crearAdmin: () => Admin, leerEnv: (clave: string) => string | undefined) {
  return async (usuarioId: string): Promise<RechazoCupo | null> => {
    let admin: Admin
    try {
      admin = crearAdmin()
    } catch {
      // Falla cerrado: sin la clave de servicio no se puede contar y no se envía nada.
      console.error('enviar-correo-proveedor: no se pudo crear el cliente del cupo')
      return { status: 503, error: 'No se pudo verificar tu cuota de uso.' }
    }
    return await rechazoPorCupo(admin, usuarioId, FUNCIONALIDAD_CORREO_PROVEEDOR, limiteDeCupo(leerEnv('CORREO_PROVEEDOR_LIMITE_HORA'), LIMITE_POR_DEFECTO), { agotado: TEXTO_CUPO_AGOTADO })
  }
}
