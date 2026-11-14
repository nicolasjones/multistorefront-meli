// Contenido del correo del resumen semanal (F-REP-08, RF-REP-08-3, RF-REP-08-8). Texto plano en castellano: los nombres de
// tienda y de producto son datos del usuario y nunca se interpretan como HTML ni entran sin sanear en una cabecera. Solo
// agregados de la organización: ningún dato de clientes.
import { lineaSegura } from '../_shared/texto.ts'

export type Tienda = { nombre: string; facturado: number }
export type ProductoEnAlerta = { nombre: string; sku: string; estado: 'sin_stock' | 'stock_bajo' }

export type ContenidoResumen = {
  desde: string
  hasta: string
  fuentes?: string[]
  ventas?: {
    facturado: number
    facturado_anterior: number
    comprobantes: number
    unidades: number
    tiendas?: Tienda[]
  }
  rentabilidad?: {
    vendido: number
    margen: number
    margen_pct: number | null
    productos_en_riesgo?: number
  }
  stock?: { sin_stock: number; stock_bajo: number; productos?: ProductoEnAlerta[] }
  faltantes?: { pendientes: number; unidades: number; dias_mas_antiguo: number | null }
}

/** Tope de nombres listados por sección; el resto se resume con el total y el enlace. */
export const TOPE_ITEMS = 5

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const pesos = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 })
const entero = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
const decimal = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export const formatearPesos = (valor: number): string => pesos.format(Number(valor) || 0)
export const formatearEntero = (valor: number): string => entero.format(Number(valor) || 0)

/** Un día `AAAA-MM-DD` como «15 de marzo» (o «15 de marzo de 2027» con el año). */
export function formatearDia(iso: string, conAnio = false): string {
  const [anio, mes, dia] = iso.split('-').map(Number)
  if (!anio || !mes || !dia || mes < 1 || mes > 12) return lineaSegura(iso)
  return `${dia} de ${MESES[mes - 1]}${conAnio ? ` de ${anio}` : ''}`
}

export function periodoTexto(desde: string, hasta: string): string {
  return `${formatearDia(desde)} al ${formatearDia(hasta, true)}`
}

export const normalizarPanelUrl = (panelUrl: string): string => panelUrl.trim().replace(/\/+$/, '')

export const enlaces = (panelUrl: string) => {
  const base = normalizarPanelUrl(panelUrl)
  return {
    panel: `${base}/`,
    ventas: `${base}/ventas/reportes`,
    rentabilidad: `${base}/rentabilidad`,
    tableros: `${base}/reportes/tableros`,
    stock: `${base}/stock`,
    faltantes: `${base}/ventas/faltantes`,
    pausar: `${base}/organizacion`,
    baja: `${base}/cuenta/avisos`,
  }
}

export function asuntoResumenSemanal(organizacion: string, desde: string, hasta: string): string {
  return lineaSegura(`Resumen semanal de ${organizacion}: ${formatearDia(desde)} al ${formatearDia(hasta)}`)
}

function variacion(actual: number, anterior: number): string {
  if (!(anterior > 0)) return actual > 0 ? 'sin ventas la semana anterior para comparar' : 'igual que la semana anterior'
  const pct = ((actual - anterior) / anterior) * 100
  if (Math.abs(pct) < 0.05) return 'igual que la semana anterior'
  return `${pct > 0 ? '+' : '−'}${decimal.format(Math.abs(pct))} % respecto de la semana anterior`
}

export function cuerpoResumenSemanal(
  contenido: ContenidoResumen,
  { organizacion, panelUrl }: { organizacion: string; panelUrl: string },
): string {
  const e = enlaces(panelUrl)
  const lineas: string[] = [
    `Resumen semanal de ${lineaSegura(organizacion)}`,
    `Semana del ${periodoTexto(contenido.desde, contenido.hasta)}.`,
    '',
  ]
  let hayAlgunaSeccion = false

  if (contenido.ventas) {
    hayAlgunaSeccion = true
    const v = contenido.ventas
    lineas.push('VENTAS')
    if (v.comprobantes === 0 && !(v.facturado > 0)) {
      lineas.push('  No hubo ventas en la semana.')
    } else {
      lineas.push(`  Facturado: ${formatearPesos(v.facturado)} (${variacion(v.facturado, v.facturado_anterior)})`)
      lineas.push(`  Comprobantes: ${formatearEntero(v.comprobantes)} · Unidades: ${formatearEntero(v.unidades)}`)
      for (const t of (v.tiendas ?? []).slice(0, TOPE_ITEMS)) {
        lineas.push(`  • ${lineaSegura(t.nombre)}: ${formatearPesos(t.facturado)}`)
      }
    }
    lineas.push(`  Ver el detalle: ${e.ventas}`, '')
  }

  if (contenido.rentabilidad) {
    hayAlgunaSeccion = true
    const r = contenido.rentabilidad
    lineas.push('MARGEN Y RENTABILIDAD')
    if (!(r.vendido > 0) && !r.margen) {
      lineas.push('  No hubo ventas con costo cargado en la semana.')
    } else {
      const pct = r.margen_pct === null || r.margen_pct === undefined ? '' : ` (${decimal.format(r.margen_pct)} % del vendido)`
      lineas.push(`  Margen real de lo vendido: ${formatearPesos(r.margen)}${pct}`)
      lineas.push(`  Vendido (sin IVA): ${formatearPesos(r.vendido)}`)
    }
    if (typeof r.productos_en_riesgo === 'number') {
      lineas.push(
        r.productos_en_riesgo > 0
          ? `  Productos con margen bajo o negativo hoy: ${formatearEntero(r.productos_en_riesgo)}`
          : '  Ningún producto con margen bajo o negativo hoy.',
      )
    }
    lineas.push(`  Ver la rentabilidad: ${e.rentabilidad}`, '')
  }

  if (contenido.stock) {
    hayAlgunaSeccion = true
    const s = contenido.stock
    lineas.push('STOCK EN ALERTA')
    lineas.push(`  ${formatearEntero(s.sin_stock)} sin stock y ${formatearEntero(s.stock_bajo)} con stock bajo.`)
    const productos = (s.productos ?? []).slice(0, TOPE_ITEMS)
    for (const p of productos) {
      lineas.push(`  • ${lineaSegura(p.nombre)} (SKU ${lineaSegura(p.sku)}) — ${p.estado === 'sin_stock' ? 'Sin stock' : 'Stock bajo'}`)
    }
    const total = s.sin_stock + s.stock_bajo
    if (total > productos.length) lineas.push(`  … y ${formatearEntero(total - productos.length)} más.`)
    lineas.push(`  Revisar el stock: ${e.stock}`, '')
  }

  if (contenido.faltantes) {
    hayAlgunaSeccion = true
    const f = contenido.faltantes
    lineas.push('FALTANTES PENDIENTES')
    lineas.push(`  ${formatearEntero(f.pendientes)} ${f.pendientes === 1 ? 'faltante abierto' : 'faltantes abiertos'} (${formatearEntero(f.unidades)} ${f.unidades === 1 ? 'unidad' : 'unidades'}).`)
    if (typeof f.dias_mas_antiguo === 'number' && f.dias_mas_antiguo > 0) {
      lineas.push(`  El más antiguo lleva ${formatearEntero(f.dias_mas_antiguo)} ${f.dias_mas_antiguo === 1 ? 'día' : 'días'}.`)
    }
    lineas.push(`  Resolver los faltantes: ${e.faltantes}`, '')
  }

  if (!hayAlgunaSeccion) {
    lineas.push('Esta semana no hay novedades para resumir.', '')
  } else if (!contenido.stock && !contenido.faltantes && (contenido.fuentes ?? []).some((f) => f === 'stock' || f === 'faltantes')) {
    lineas.push('Sin alertas de stock ni faltantes pendientes.', '')
  }

  lineas.push(
    `Abrí el panel: ${e.panel}`,
    `Análisis más a fondo: ${e.tableros}`,
    '',
    '—',
    'Recibís este resumen porque sos administrador de la organización.',
    `Para pausarlo en toda la organización: ${e.pausar} (Mi organización, «Resumen semanal por correo»).`,
    `Para no recibirlo vos: ${e.baja} (Avisos por correo).`,
    '',
  )
  return lineas.join('\n')
}
