// Códigos genéricos de `dominio.faltantes_avisos.ultimo_error` (MSF-161 m-4b). La lista ES la del check
// `faltantes_avisos_ultimo_error_codigo_chk` de la migración 20270306120000: un test (handler.test.ts) la compara con el SQL y un
// pgTAP con la base, así no se puede ampliar uno sin el otro.
export const CODIGOS_ERROR_BASE = [
  'smtp_auth',
  'smtp_conexion',
  'smtp_timeout',
  'destinatario_invalido',
  'sin_correo',
  'faltante_cerrado',
  'intentos_agotados',
  'otro',
] as const

/** Los que puede producir la función al enviar (el resto los escribe la base). */
export type CodigoError = 'smtp_auth' | 'smtp_conexion' | 'smtp_timeout' | 'destinatario_invalido' | 'otro'
