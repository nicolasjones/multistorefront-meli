import { supabaseClient } from './supabase'
import type { NivelSeccion } from './permisos'

// Pantalla de Inicio (F-INI-01, MSF-344). Solo lecturas de objetos que ya existen: la base
// (RLS + nivel_seccion) decide qué filas ve cada rol; acá se cuenta y se rotula.

export type ConteoStock = { sinStock: number; stockBajo: number; total: number }

// `public.stock_estados` es de la organización (no tiene empresa): mismos conteos que el resumen de Stock.
export async function leerConteoStock(): Promise<ConteoStock> {
  const contar = (estado?: 'sin_stock' | 'stock_bajo') => {
    const consulta = supabaseClient.from('stock_estados').select('producto_id', { count: 'exact', head: true })
    return estado ? consulta.eq('estado', estado) : consulta
  }
  const [sinStock, stockBajo, total] = await Promise.all([contar('sin_stock'), contar('stock_bajo'), contar()])
  for (const resultado of [sinStock, stockBajo, total]) {
    if (resultado.error) throw resultado.error
  }
  return { sinStock: sinStock.count ?? 0, stockBajo: stockBajo.count ?? 0, total: total.count ?? 0 }
}

// Consultas en estado `nueva` de `public.consultas_bandeja`, acotadas a la empresa activa si la hay.
export async function leerConsultasNuevas(empresaId: string | null): Promise<number> {
  let consulta = supabaseClient.from('consultas_bandeja').select('id', { count: 'exact', head: true }).eq('estado', 'nueva')
  if (empresaId) consulta = consulta.eq('empresa_id', empresaId)
  const { count, error } = await consulta
  if (error) throw error
  return count ?? 0
}

export function puedeVer(nivel: NivelSeccion | null): boolean {
  return nivel === 'lectura' || nivel === 'edicion'
}

export function puedeEditar(nivel: NivelSeccion | null): boolean {
  return nivel === 'edicion'
}

const formatoFecha = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Argentina/Buenos_Aires' })

// «Jueves 8 de octubre» (Main.dc.html): día de la semana con mayúscula inicial.
export function fechaDeInicio(ahora: Date): string {
  const texto = formatoFecha.format(ahora).replace(',', '')
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

export function saludoDeInicio(nombre: string | null): string {
  return nombre ? `Buen día, ${nombre}` : 'Buen día'
}

export function pluralizar(cantidad: number, singular: string, plural: string): string {
  return `${cantidad} ${cantidad === 1 ? singular : plural}`
}

// Alertas accionables (F-INI-02, MSF-361). Se leen de `public.alertas_inicio_visibles` (security_invoker: la
// base deja pasar solo las secciones con ≥ lectura y las empresas accesibles). El enlace de cada alerta sale
// de una lista cerrada por tipo en el cliente (FR-025): lo que venga en la columna `enlace` nunca se usa como ruta.
export type TipoAlerta = 'sin_stock' | 'stock_bajo' | 'consultas_sin_atender' | 'dolar_sin_cargar' | 'margen_negativo'

export type AlertaInicio = {
  id: string
  empresaId: string | null
  tipo: TipoAlerta
  cantidad: number
  calculadaEn: string
}

export const ENLACE_ALERTA: Record<TipoAlerta, string> = {
  sin_stock: '/stock',
  stock_bajo: '/stock',
  consultas_sin_atender: '/consultas',
  dolar_sin_cargar: '/cotizacion',
  margen_negativo: '/rentabilidad/productos',
}

const ORDEN_ALERTA = Object.keys(ENLACE_ALERTA) as TipoAlerta[]

type FilaAlerta = { id: string; empresa_id: string | null; tipo: string; cantidad: number; calculada_en: string }

// En una empresa activa se ven las alertas de esa empresa y las de la organización entera (empresa nula).
export async function leerAlertasInicio(empresaId: string | null): Promise<AlertaInicio[]> {
  let consulta = supabaseClient.from('alertas_inicio_visibles').select('id, empresa_id, tipo, cantidad, calculada_en')
  if (empresaId) consulta = consulta.or(`empresa_id.is.null,empresa_id.eq.${empresaId}`)
  const { data, error } = await consulta
  if (error) throw error
  return ((data ?? []) as FilaAlerta[])
    .filter((fila): fila is FilaAlerta & { tipo: TipoAlerta } => fila.tipo in ENLACE_ALERTA)
    .map((fila) => ({ id: fila.id, empresaId: fila.empresa_id, tipo: fila.tipo, cantidad: fila.cantidad, calculadaEn: fila.calculada_en }))
    .sort((a, b) => ORDEN_ALERTA.indexOf(a.tipo) - ORDEN_ALERTA.indexOf(b.tipo))
}

// Fecha del último cálculo de la organización (null si nunca se calculó).
export async function leerUltimoCalculoAlertas(): Promise<string | null> {
  const { data, error } = await supabaseClient.from('alertas_inicio_calculo').select('calculada_en').limit(1)
  if (error) throw error
  return (data as { calculada_en: string }[] | null)?.[0]?.calculada_en ?? null
}

// Umbral de demora: se recalcula cada 15 minutos y se avisa pasada 1 hora (D-2).
export const UMBRAL_DEMORA_ALERTAS_MS = 60 * 60 * 1000

export function alertasDemoradas(calculadaEn: string | null, ahora: Date): boolean {
  if (calculadaEn === null) return true
  const instante = Date.parse(calculadaEn)
  return Number.isNaN(instante) || ahora.getTime() - instante > UMBRAL_DEMORA_ALERTAS_MS
}

const formatoHora = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' })
const formatoDiaHora = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' })

// «14:30» si es de hoy; «8 de octubre, 14:30» si es de otro día.
export function horaDeCalculo(calculadaEn: string, ahora: Date): string {
  const fecha = new Date(calculadaEn)
  const mismoDia = fecha.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) === ahora.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })
  return mismoDia ? formatoHora.format(fecha) : formatoDiaHora.format(fecha)
}

export function textoAlerta(tipo: TipoAlerta, cantidad: number): string {
  switch (tipo) {
    case 'sin_stock': return pluralizar(cantidad, 'producto sin stock', 'productos sin stock')
    case 'stock_bajo': return pluralizar(cantidad, 'producto con stock bajo', 'productos con stock bajo')
    case 'consultas_sin_atender': return pluralizar(cantidad, 'consulta nueva sin atender', 'consultas nuevas sin atender')
    case 'dolar_sin_cargar': return 'Todavía no se cargó el dólar de hoy'
    case 'margen_negativo': return pluralizar(cantidad, 'producto con margen negativo', 'productos con margen negativo')
  }
}
