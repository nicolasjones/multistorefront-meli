type ErrorConCodigo = { code?: unknown } | null | undefined

const MENSAJES_POR_CODIGO: Readonly<Record<string, string>> = {
  '42501': 'No tenés permiso para esta acción. Puede que tu rol haya cambiado: recargá la página.',
  P0002: 'El dato que buscás ya no existe o no pertenece a tu organización.',
  '40001': 'Otra persona modificó este dato. Recargá la página e intentá de nuevo.',
}

/**
 * Texto en castellano para un error de Postgres/PostgREST/Edge Function.
 * El `message` crudo puede nombrar políticas, funciones o restricciones: nunca va a la UI.
 * Se mapea por `code` (como `lib/proveedores.ts`); `porCodigo` agrega mensajes de negocio
 * propios de la pantalla y el detalle técnico queda solo en consola.
 */
export function mensajeDeErrorBase(
  error: unknown,
  porDefecto: string,
  porCodigo: Readonly<Record<string, string>> = {},
): string {
  console.error(porDefecto, error)
  const codigo = String((error as ErrorConCodigo)?.code ?? '')
  return porCodigo[codigo] ?? MENSAJES_POR_CODIGO[codigo] ?? porDefecto
}
