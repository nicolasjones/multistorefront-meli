// Contenido del correo del resumen de reposición (F-STK-09, FR-203). Texto plano: el nombre y el SKU de
// un producto son datos del usuario y nunca se interpretan como HTML ni entran sin sanear en una cabecera.
import { lineaSegura } from '../_shared/texto.ts'

/** Tope de productos listados por correo; el resto se resume con el total y el enlace (plan.md). */
export const TOPE_PRODUCTOS = 50

export type EstadoAlerta = 'sin_stock' | 'stock_bajo'

export type ProductoResumen = {
  producto_id: string
  nombre: string
  sku: string
  cantidad: number
  disponible: number
  minimo: number
  estado: EstadoAlerta
}

const ETIQUETA: Record<EstadoAlerta, string> = { sin_stock: 'Sin stock', stock_bajo: 'Stock bajo' }

/** «Sin stock» primero y luego por nombre (y SKU para desempatar). */
export function ordenarProductos(productos: ProductoResumen[]): ProductoResumen[] {
  return [...productos].sort((a, b) =>
    (a.estado === 'sin_stock' ? 0 : 1) - (b.estado === 'sin_stock' ? 0 : 1)
    || a.nombre.localeCompare(b.nombre, 'es')
    || a.sku.localeCompare(b.sku, 'es'))
}

export const enlaceStock = (panelUrl: string): string => `${panelUrl.trim().replace(/\/+$/, '')}/stock`

export function asuntoResumen(sinStock: number, stockBajo: number): string {
  const sin = `${sinStock} ${sinStock === 1 ? 'producto sin stock' : 'productos sin stock'}`
  return lineaSegura(`${sin} y ${stockBajo} con stock bajo`)
}

export function cuerpoResumen(productos: ProductoResumen[], enlace: string, tope = TOPE_PRODUCTOS): string {
  const ordenados = ordenarProductos(productos)
  const visibles = ordenados.slice(0, tope)
  const sinStock = ordenados.filter((p) => p.estado === 'sin_stock').length
  const stockBajo = ordenados.length - sinStock
  const lineas = visibles.flatMap((p) => [
    `• ${lineaSegura(p.nombre)} (SKU ${lineaSegura(p.sku)}) — ${ETIQUETA[p.estado]}`,
    `  Stock: ${p.cantidad} · Disponible: ${p.disponible} · Mínimo: ${p.minimo}`,
  ])
  const resto = ordenados.length - visibles.length
  return [
    `Productos que entraron en alerta de reposición: ${sinStock} sin stock y ${stockBajo} con stock bajo.`,
    '',
    ...lineas,
    ...(resto > 0 ? ['', `… y ${resto} más. Total: ${ordenados.length} productos. Verlos todos en el panel.`] : []),
    '',
    `Revisá el stock en el panel: ${enlace}`,
    '',
  ].join('\n')
}
