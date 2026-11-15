// Reglas de redacción del correo masivo (F-CLI-12, FR-010): las mismas que aplica la base (asunto ≤ 200 sin saltos de
// línea, mensaje ≤ 10 000, ambos obligatorios). El mensaje es texto: nunca se interpreta como HTML.
export const ASUNTO_MAXIMO = 200
export const MENSAJE_MAXIMO = 10000

// Texto del pie fijo de cada correo (lo agrega el envío y no se puede quitar ni editar, FR-012). La vista previa
// muestra el mismo pie con un enlace de ejemplo (FR-013).
export const PIE_CORREO_MASIVO = 'Recibís este correo porque aceptaste recibir novedades. Si no querés recibirlo más,'
export const TEXTO_ENLACE_BAJA = 'date de baja acá'
export const ENLACE_BAJA_EJEMPLO = '/baja-correo/ejemplo'

export type ErroresRedaccion = { asunto: string | null; mensaje: string | null }

export function validarRedaccion(asunto: string, mensaje: string): ErroresRedaccion {
  return {
    asunto: asunto.trim() === ''
      ? 'El asunto es obligatorio.'
      : asunto.length > ASUNTO_MAXIMO
        ? `El asunto admite hasta ${ASUNTO_MAXIMO} caracteres.`
        : /[\r\n]/.test(asunto)
          ? 'El asunto no puede tener saltos de línea.'
          : null,
    mensaje: mensaje.trim() === ''
      ? 'El mensaje es obligatorio.'
      : mensaje.length > MENSAJE_MAXIMO
        ? `El mensaje admite hasta ${MENSAJE_MAXIMO} caracteres.`
        : null,
  }
}

export const redaccionValida = (errores: ErroresRedaccion) => errores.asunto === null && errores.mensaje === null

// Clave de idempotencia de una campaña: se genera al abrir la confirmación y se reutiliza si se repite el clic.
export const nuevaClaveCampana = (): string => crypto.randomUUID()

type ErrorRpc = { message?: string; code?: string; hint?: string } | null | undefined

// Mensaje para quien envía; nunca el detalle técnico de la base.
export function textoErrorCorreoMasivo(error: ErrorRpc): string {
  if (error?.hint === 'sin_destinatarios') return 'No hay clientes elegibles: necesitan estar activos, tener un correo válido y aceptar el correo masivo.'
  if (error?.hint === 'limite') return 'Ya pediste varias pruebas en la última hora. Probá de nuevo en un rato.'
  if (error?.hint === 'sin_correo') return 'Tu usuario no tiene un correo para recibir la prueba.'
  if (error?.code === '42501') return 'Tu rol no puede enviar el correo masivo.'
  if (error?.code === '22023' && error.message) return error.message
  return 'No pudimos completar el envío. Probá de nuevo.'
}
