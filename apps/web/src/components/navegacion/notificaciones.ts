// F-NOT-02 (MSF-378): tipos y formato de la campanita de notificaciones.
export interface Notificacion {
  id: string
  tipo_nombre: string
  datos: Record<string, unknown> | null
  creado_en: string
  leido_en: string | null
}

export interface TandaNotificaciones {
  total: number
  items: Notificacion[]
}

export const LIMITE_TANDA = 20
const MAXIMO_DETALLE = 140

// Los `datos` del aviso ya traen etiquetas legibles («Nombre», «Producto»…): se muestran como texto plano
// «Clave: valor», sin objetos anidados ni identificadores, recortados.
export function detalleLegible(datos: Notificacion['datos']): string {
  if (!datos || typeof datos !== 'object') return ''
  const partes = Object.entries(datos)
    .filter(([, valor]) => (typeof valor === 'string' && valor.trim() !== '') || typeof valor === 'number')
    .map(([clave, valor]) => `${clave}: ${String(valor).trim()}`)
  const texto = partes.join(' · ')
  return texto.length > MAXIMO_DETALLE ? `${texto.slice(0, MAXIMO_DETALLE - 1).trimEnd()}…` : texto
}

const FORMATO = new Intl.RelativeTimeFormat('es', { numeric: 'auto' })
const UNIDADES: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
]

export function horaRelativa(iso: string, ahora: number = Date.now()): string {
  const diferencia = new Date(iso).getTime() - ahora
  if (Number.isNaN(diferencia)) return ''
  if (Math.abs(diferencia) < 60_000) return 'ahora'
  for (const [unidad, ms] of UNIDADES) {
    if (Math.abs(diferencia) >= ms) return FORMATO.format(Math.trunc(diferencia / ms), unidad)
  }
  return 'ahora'
}
