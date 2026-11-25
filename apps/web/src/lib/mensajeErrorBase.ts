type ErrorConCodigo = { code?: unknown } | null | undefined

const MENSAJES_POR_CODIGO: Readonly<Record<string, string>> = {
  '42501': 'No tenés permiso para esta acción. Puede que tu rol haya cambiado: recargá la página.',
  P0002: 'El dato que buscás ya no existe o no pertenece a tu organización.',
  // Mismos textos con el código que PostgREST traduce a 4xx (404 y 409): las RPC migradas dejan de contestar 500.
  PT404: 'El dato que buscás ya no existe o no pertenece a tu organización.',
  PT409: 'Esta acción no se puede hacer en el estado actual. Recargá la página para ver cómo está.',
  PT412: 'Otra persona modificó este dato. Recargá la página e intentá de nuevo.',
  '40001': 'Otra persona modificó este dato. Recargá la página e intentá de nuevo.',
  // Errores de negocio que la base lanza a propósito (clase 55 y 54): se explican a la persona. Ver docs/errores-negocio-postgrest.md.
  '55000': 'Esta acción no se puede hacer en el estado actual. Recargá la página para ver cómo está.',
  '55006': 'Ya hay una operación en curso. Esperá a que termine e intentá de nuevo.',
  '54000': 'Superaste el tamaño máximo permitido para esta operación. Reducí la cantidad e intentá de nuevo.',
}

// `40001` es el código histórico del conflicto de edición; `PT412` (HTTP 412) el que usan las RPC de comprobantes desde
// 20270507340000. El cliente acepta los dos porque la migración y el despliegue de la web no son simultáneos.
// `55000` es el código histórico de «el estado o la regla de negocio no admite la acción»; `PT409` (HTTP 409) el que usan las
// RPC migradas desde 20270507310000, 20270507340000 y 20270507440000. El cliente acepta los dos mientras migración y despliegue no son simultáneos.
export const esCodigoDeEstado = (codigo: unknown): boolean => codigo === '55000' || codigo === 'PT409'

export const esCodigoDeConflicto = (codigo: unknown): boolean => codigo === '40001' || codigo === 'PT412'

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
