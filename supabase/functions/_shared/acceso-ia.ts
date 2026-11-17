// Decisión de acceso a una función de IA ANTES de gastar crédito del proveedor, como función pura (sin Deno ni
// Supabase) para probarla con `node --test` (acceso-ia.test.ts). Las funciones la usan con el resultado de
// `tiene_feature_publica` ejecutado con el JWT del propio usuario.
export type Rechazo = { status: number; error: string }

export function rechazoPorFuncionalidad(
  resultado: { data: unknown; error: unknown },
  textos: { noHabilitada: string; noVerificable: string },
): Rechazo | null {
  // Un error al verificar NO es «sin funcionalidad»: es un fallo del servicio (503), y tampoco deja pasar.
  if (resultado.error) return { status: 503, error: textos.noVerificable }
  if (resultado.data !== true) return { status: 403, error: textos.noHabilitada }
  return null
}
