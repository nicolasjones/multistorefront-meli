// Cupo PERSISTENTE de uso de IA por usuario, funcionalidad y hora (lote 90, MSF-727), como función pura (sin Deno ni Supabase)
// para probarla con `node --test` (cupo-ia.test.ts). Lo consume `public.consumir_cupo_ia` (solo service_role) con el cliente admin:
// el contador vive en la base (`private.ia_cupo_uso`), no en el isolate ni en tablas que el usuario pueda borrar.
// Se llama DESPUÉS de verificar funcionalidad y conversación y ANTES de llamar al proveedor; un error al consumir NO deja pasar (503).
export const LIMITE_CUPO_POR_HORA = 30
export const FUNCIONALIDAD_CHAT = 'chat-ia'
export const FUNCIONALIDAD_DOCUMENTOS = 'busqueda-documental'

export type RechazoCupo = { status: number; error: string; retryAfter?: number }
type Rpc = (nombre: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>

// Tope configurable por ENV de cada función; un valor ausente o inválido vuelve al predeterminado.
export function limiteDeCupo(valor: string | undefined): number {
  const n = Number(valor)
  return Number.isInteger(n) && n > 0 ? n : LIMITE_CUPO_POR_HORA
}

export async function rechazoPorCupo(
  admin: { rpc: Rpc },
  usuarioId: string,
  funcionalidad: string,
  limite: number,
  textos: { agotado: string },
): Promise<RechazoCupo | null> {
  const { data, error } = await admin.rpc('consumir_cupo_ia', { p_usuario: usuarioId, p_funcionalidad: funcionalidad, p_limite: limite })
  const fila = Array.isArray(data) ? data[0] : data
  // Sin respuesta interpretable no se gasta crédito: falla cerrado (503), igual que la verificación de funcionalidad.
  if (error || !fila || typeof fila.se_consumio !== 'boolean') return { status: 503, error: 'No se pudo verificar tu cuota de uso.' }
  if (fila.se_consumio) return null
  const segundos = Number(fila.segundos_hasta_reinicio)
  return { status: 429, error: textos.agotado, retryAfter: Number.isFinite(segundos) && segundos >= 1 ? Math.ceil(segundos) : 3600 }
}

// ¿El fallo del proveedor fue por tiempo de espera? (AbortSignal.timeout / fetch abortado, o el error de negocio que el transporte lanza)
export function esTimeoutDeProveedor(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const { name, message } = error as { name?: unknown; message?: unknown }
  return name === 'TimeoutError' || name === 'AbortError' || message === 'INVOCACION_PROVEEDOR_IA_TIMEOUT' || message === 'EMBEDDING_PROVEEDOR_IA_TIMEOUT'
}
