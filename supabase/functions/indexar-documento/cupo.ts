// Cableado del cupo por usuario y hora de `indexar-documento` (lote 92, MSF-727), con dependencias inyectables para probarlo con
// `node --test` (cupo.test.ts) sin Deno ni Supabase. Mismo patrón que `enviar-correo-proveedor/cupo.ts`: `index.ts` solo pasa la
// creación del cliente admin real y la lectura del entorno.
import { FUNCIONALIDAD_INDEXAR_DOCUMENTO, limiteDeCupo, rechazoPorCupo, type RechazoCupo } from '../_shared/cupo-ia.ts'

// 20 indexaciones por usuario y hora. Una indexación llega a MAX_FRAGMENTOS (2000) embeddings de ~1200 caracteres: 20 por hora acotan el
// gasto de un usuario a ~40.000 embeddings por hora (decenas de miles de tokens por fragmento a lo sumo, centavos de dólar con
// `text-embedding-3-small`) y sobran para la carga normal de un administrador (un manual o un lote de documentos). Un reintento desde la
// pantalla cuenta como otra indexación si llega hasta los embeddings.
export const LIMITE_POR_DEFECTO = 20
export const VARIABLE_LIMITE = 'INDEXAR_DOCUMENTO_LIMITE_HORA'
export const TEXTO_CUPO_AGOTADO = 'Indexaste demasiados documentos en poco tiempo. Probá de nuevo más tarde.'
export const TEXTO_CUPO_NO_VERIFICABLE = 'No se pudo verificar tu cuota de uso.'

type Admin = Parameters<typeof rechazoPorCupo>[0]

export function crearConsumirCupo(crearAdmin: () => Admin, leerEnv: (clave: string) => string | undefined) {
  return async (usuarioId: string): Promise<RechazoCupo | null> => {
    let admin: Admin
    try {
      admin = crearAdmin()
    } catch {
      // Falla cerrado si `crearAdmin` lanza: no se puede contar y no se gasta crédito de embeddings. (En `index.ts` el cliente de servicio ya existe
      // aquí: sin `SUPABASE_SERVICE_ROLE_KEY` la función falla antes, en la política o la credencial, con 500; es igualmente cerrado.)
      console.error('indexar-documento: no se pudo crear el cliente del cupo')
      return { status: 503, error: TEXTO_CUPO_NO_VERIFICABLE }
    }
    return await rechazoPorCupo(admin, usuarioId, FUNCIONALIDAD_INDEXAR_DOCUMENTO, limiteDeCupo(leerEnv(VARIABLE_LIMITE), LIMITE_POR_DEFECTO), { agotado: TEXTO_CUPO_AGOTADO })
  }
}
