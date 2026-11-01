// Contrato: specs/servidor-mcp-generico/contracts/protocolo-mcp.md
//
// Resuelve la organización de una credencial MCP vía private.validar_credencial_mcp
// (otorgada solo a service_role — el servidor MCP corre con ese nivel de
// confianza, nunca con la sesión de un usuario del panel, porque no hay
// "usuario logueado" en este canal). Nunca usa service_role para leer datos
// de negocio sin pasar por una función que centralice el filtro de
// organización — ver private.mcp_leer_fila, usada desde herramientas.ts.
import { timingSafeEqual } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type ConexionAutenticada = {
  organizacionId: string
  credencialId: string
  admin: SupabaseClient
  token: string
}

export function crearClienteAdmin(): SupabaseClient {
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno del servidor MCP.')
  }
  return createClient(supabaseUrl, serviceRoleKey)
}

export async function autenticarConexion(admin: SupabaseClient, token: string | undefined): Promise<ConexionAutenticada | null> {
  if (!token) return null

  const { data: organizacionId, error } = await admin.rpc('validar_credencial_mcp', { p_token: token })
  if (error || !organizacionId) return null

  // private.validar_credencial_mcp solo devuelve organizacion_id (no el id
  // de la fila) — para auditar conexiones_mcp y para iniciar_ejecucion_mcp
  // (US2) hace falta el id, resuelto acá una sola vez por hash (mismo
  // criterio: nunca comparar por token en texto plano) y guardado en la
  // conexión en vez de volver a pedirlo en cada herramienta ejecutable.
  const { data: credencialId, error: credencialIdError } = await admin.rpc('resolver_credencial_id_mcp', { p_token: token })
  if (credencialIdError || !credencialId) return null

  const { error: conexionError } = await admin.from('conexiones_mcp').insert({
    credencial_id: credencialId,
    conectado_en: new Date().toISOString(),
  })
  if (conexionError) {
    // No bloquea la conexión por un fallo de auditoría (FR-009 pide
    // registrar, no condicionar el acceso a que el registro funcione) —
    // pero tampoco lo silencia: si esto empieza a fallar seguido, debe
    // verse en los logs del proceso, no perderse.
    console.error('No se pudo registrar la conexión MCP en conexiones_mcp:', conexionError.message)
  }

  return { organizacionId, credencialId, admin, token }
}

// Motivo por el que una sesión existente no puede seguir.
//
// - `token-ausente` / `token-distinto`: el Bearer no es el de la sesión. No
//   dice NADA de la credencial: puede ser otro cliente que adivinó el id de
//   sesión, no la sesión legítima. La sesión NO se cierra (solo se rechaza la
//   solicitud) — cerrar acá le permitiría a cualquiera tumbar la sesión de
//   otro sin tener su credencial (MSF-677).
// - `credencial-revocada`: el Bearer es el de la sesión, pero la credencial ya
//   no está activa (`revocada_en is null` falla). Ahí sí se cierra la sesión:
//   la credencial murió y la sesión no puede seguir sirviendo.
// - `error-base`: la RPC no pudo responder. Falla cerrado (se rechaza), sin
//   cerrar la sesión: un fallo transitorio de la base no puede tumbar las
//   sesiones de todos; la revocación se detecta sola en la próxima solicitud.
export type MotivoRechazo = 'token-ausente' | 'token-distinto' | 'credencial-revocada' | 'error-base'

export type ResultadoRevalidacion = { vigente: true } | { vigente: false; motivo: MotivoRechazo }

// Revalida, en cada solicitud de una sesión ya abierta, que el Bearer sea el
// mismo con el que se hizo el `initialize` y que su credencial siga activa
// (`revocada_en is null`). No audita en conexiones_mcp: no es una conexión
// nueva. Distingue POR QUÉ se rechaza, para que el servidor pueda cerrar la
// sesión solo cuando la credencial está revocada.
export async function revalidarConexion(
  admin: SupabaseClient,
  token: string | undefined,
  conexion: Pick<ConexionAutenticada, 'credencialId' | 'token'>,
): Promise<ResultadoRevalidacion> {
  if (!token) return { vigente: false, motivo: 'token-ausente' }
  if (!tokensIguales(token, conexion.token)) return { vigente: false, motivo: 'token-distinto' }
  const { data: credencialId, error } = await admin.rpc('resolver_credencial_id_mcp', { p_token: token })
  if (error) return { vigente: false, motivo: 'error-base' }
  if (credencialId !== conexion.credencialId) return { vigente: false, motivo: 'credencial-revocada' }
  return { vigente: true }
}

function tokensIguales(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}
