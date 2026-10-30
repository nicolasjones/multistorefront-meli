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
