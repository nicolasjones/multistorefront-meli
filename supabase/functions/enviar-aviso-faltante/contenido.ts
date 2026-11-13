// Contenido del correo de aviso de reposición de faltantes (F-STK-17, FR-308). Texto plano: nada de lo
// que viene de la base (nombres de cliente y producto) se interpreta como HTML ni entra en una cabecera
// sin sanear.
import { lineaSegura } from '../_shared/texto.ts'

export type LineaFaltante = {
  producto: string
  sku: string | null
  cantidad: number
  comprobante: string
  /** F-VTA-26: texto editable del aviso (null/ausente = texto por defecto de F-STK-17). */
  mensaje?: string | null
}

export const MENSAJE_MAX = 1000

/**
 * Texto plano del mensaje editable: sin caracteres de control salvo el salto de línea, a lo sumo dos saltos
 * seguidos, recortado y de hasta 1.000 caracteres. Vacío después de sanear = null (texto por defecto).
 */
// Solo espacio y salto de línea en los extremos: es EXACTAMENTE lo que recorta `private.sanear_mensaje_aviso` en la base (no `trim()`, que también quita NBSP y espacios Unicode).
const ESPACIOS_EXTREMOS = /^[ \n]+|[ \n]+$/g

export function sanearMensaje(valor: string | null | undefined): string | null {
  if (typeof valor !== 'string') return null
  const limpio = valor
    .replace(/\r\n?|[\u2028\u2029\u0085]/g, '\n')
    .replace(/\t/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g, '')
    // Sin caracteres invisibles (ancho cero, marcas y controles de dirección): no aportan texto y permiten disimular contenido.
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(ESPACIOS_EXTREMOS, '')
    .slice(0, MENSAJE_MAX)
    .replace(ESPACIOS_EXTREMOS, '')
  return limpio === '' ? null : limpio
}

/**
 * Neutraliza el dot-stuffing de SMTP (m-5): una línea que arranca con «.» (en particular una sola «.») puede
 * cortar el DATA si la librería no la duplica. Se le antepone un espacio, así ninguna línea del cuerpo empieza con punto.
 */
export const neutralizarPuntos = (texto: string): string => texto.replace(/^\./gm, ' .')

export function asuntoAviso(): string {
  return 'Ya tenemos stock de lo que pediste'
}

export function cuerpoAviso(cliente: string, lineas: LineaFaltante[]): string {
  const detalle = lineas.map((l) => {
    const sku = l.sku ? ` (${lineaSegura(l.sku)})` : ''
    return `- ${lineaSegura(l.producto)}${sku} · ${l.cantidad} u. · Comprobante ${lineaSegura(l.comprobante)}`
  })
  const saludo = `Hola ${lineaSegura(cliente) || 'cliente'},`
  const mensaje = sanearMensaje(lineas.find((l) => sanearMensaje(l.mensaje) !== null)?.mensaje)
  // Con texto editado (F-VTA-26) reemplaza las frases fijas; sin él, el correo es el de F-STK-17.
  if (mensaje) return neutralizarPuntos([saludo, '', mensaje, '', ...detalle, ''].join('\n'))
  return neutralizarPuntos([
    saludo,
    '',
    'Volvió a haber stock de los productos que tenías pedidos:',
    '',
    ...detalle,
    '',
    'Escribinos para coordinar la entrega.',
    '',
  ].join('\n'))
}
