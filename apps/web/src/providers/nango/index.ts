import Nango from '@nangohq/frontend'
import { supabaseClient } from '../../lib/supabase'

// Self-hosted: `host`, nunca `publicKey` (eso es de Nango Cloud). Sin
// VITE_NANGO_PUBLIC_SERVER_URL (falta el .env local) igual se construye la
// URL, mismo criterio que src/lib/supabase.ts — la llamada real simplemente
// falla con un error de red, no un crash al importar el módulo.
const nangoHost = import.meta.env.VITE_NANGO_PUBLIC_SERVER_URL || 'http://localhost:3005'

export type ResultadoConexionOAuth =
  | { exito: true; nangoConnectionId: string }
  | { exito: false; motivo: string }

// Contrato: specs/20260930-153545-conexiones-oauth-nango/contracts/conectar-oauth.md #2.
// El SDK de frontend de Nango (0.71.x) exige un Connect Session Token de
// corta duración para self-host — host+publicKey solo ya no alcanza. Ese
// token se genera server-to-server con NANGO_SECRET_KEY_* (nunca en el
// navegador) vía la Edge Function iniciar-sesion-oauth, que también decide
// si corresponde crear una conexión nueva o reautorizar una existente
// (según si conexiones_oauth.nango_connection_id ya está seteado).
//
// Nango asigna el connection_id real — no se puede elegir de antemano
// (research.md R8). Por eso nango.auth()/.reconnect() se llaman sin
// connectionId, y el valor real se toma de la respuesta
// (ConnectionResponseSuccess.connectionId) para persistirlo recién acá.
export async function conectarOAuth(clave: string, conexionId: string): Promise<ResultadoConexionOAuth> {
  const { data, error: fnError } = await supabaseClient.functions.invoke<{ token: string; es_reconexion: boolean }>(
    'iniciar-sesion-oauth',
    { body: { conexion_id: conexionId } },
  )

  if (fnError || !data?.token) {
    return { exito: false, motivo: 'No se pudo iniciar la sesión de conexión.' }
  }

  const nango = new Nango({ host: nangoHost, connectSessionToken: data.token })

  try {
    const resultado = data.es_reconexion ? await nango.reconnect(clave) : await nango.auth(clave)
    return { exito: true, nangoConnectionId: resultado.connectionId }
  } catch (error) {
    const motivo = error instanceof Error ? error.message : 'No se pudo completar la conexión.'
    return { exito: false, motivo }
  }
}
