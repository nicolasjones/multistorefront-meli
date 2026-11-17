type ErrorConCodigo = { code?: unknown } | null | undefined

const MENSAJES_POR_CODIGO: Readonly<Record<string, string>> = {
  '42501': 'No tenés permiso para esta acción. Puede que tu rol haya cambiado: recargá la página.',
  P0002: 'El dato que buscás ya no existe o no pertenece a tu organización.',
  '40001': 'Otra persona modificó este dato. Recargá la página e intentá de nuevo.',
  // Errores de negocio que PostgREST responde como 5xx (clase 55 y 54): no son fallas del servidor. Ver docs/errores-negocio-postgrest.md.
  '55000': 'Esta acción no se puede hacer en el estado actual. Recargá la página para ver cómo está.',
  '55006': 'Ya hay una operación en curso. Esperá a que termine e intentá de nuevo.',
  '54000': 'Superaste el tamaño máximo permitido para esta operación. Reducí la cantidad e intentá de nuevo.',
}

/**
 * Códigos que la base lanza a propósito para decir «no» al usuario y que PostgREST contesta como 5xx (o 4xx
 * inconsistente). El panel los trata como error de negocio, no como falla del servidor.
 */
export const CODIGOS_NEGOCIO_CON_RESPUESTA_5XX: readonly string[] = ['P0002', '40001', '54000', '55000', '55006']

export function esErrorDeNegocio(error: unknown): boolean {
  return CODIGOS_NEGOCIO_CON_RESPUESTA_5XX.includes(String((error as ErrorConCodigo)?.code ?? ''))
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
  const codigo = String((error as ErrorConCodigo)?.code ?? '')
  // Solo el código: `details`/`hint` de PostgREST pueden traer datos de la fila (PII).
  console.error(porDefecto, codigo || 'sin código')
  return porCodigo[codigo] ?? MENSAJES_POR_CODIGO[codigo] ?? porDefecto
}
