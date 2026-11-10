// Contenido del correo de aviso de reposición de faltantes (F-STK-17, FR-308). Texto plano: nada de lo
// que viene de la base (nombres de cliente y producto) se interpreta como HTML ni entra en una cabecera
// sin sanear.
import { lineaSegura } from '../_shared/texto.ts'

export type LineaFaltante = { producto: string; sku: string | null; cantidad: number; comprobante: string }

export function asuntoAviso(): string {
  return 'Ya tenemos stock de lo que pediste'
}

export function cuerpoAviso(cliente: string, lineas: LineaFaltante[]): string {
  const detalle = lineas.map((l) => {
    const sku = l.sku ? ` (${lineaSegura(l.sku)})` : ''
    return `- ${lineaSegura(l.producto)}${sku} · ${l.cantidad} u. · Comprobante ${lineaSegura(l.comprobante)}`
  })
  return [
    `Hola ${lineaSegura(cliente) || 'cliente'},`,
    '',
    'Volvió a haber stock de los productos que tenías pedidos:',
    '',
    ...detalle,
    '',
    'Escribinos para coordinar la entrega.',
    '',
  ].join('\n')
}
