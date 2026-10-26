import { supabaseClient } from './supabase'
import type { VarianteEtiqueta } from '../components/base/EtiquetaEstado'

// Presupuestos (F-VTA-08, MSF-331). Aceptar, copiar y listar pasan por RPC (`aceptar_presupuesto`,
// `copiar_presupuesto`, `listar_presupuestos`): la autoridad de permisos y de estado es la base; acá
// `puede_editar` y el estado solo deciden qué acciones se ofrecen. «Vencido» lo deriva la base de
// `valido_hasta` (FR-055). Contrato en docs/ventas-comprobantes.md.

export type EstadoPresupuesto = 'pendiente' | 'aceptado' | 'vencido' | 'convertido'
export type FiltroEstadoPresupuesto = 'todos' | EstadoPresupuesto

export const FILTROS_ESTADO: ReadonlyArray<{ valor: FiltroEstadoPresupuesto; etiqueta: string }> = [
  { valor: 'todos', etiqueta: 'Todos' },
  { valor: 'pendiente', etiqueta: 'Pendiente' },
  { valor: 'aceptado', etiqueta: 'Aceptado' },
  { valor: 'vencido', etiqueta: 'Vencido' },
  { valor: 'convertido', etiqueta: 'Convertido en factura' },
]

const ETIQUETA_ESTADO: Readonly<Record<EstadoPresupuesto, string>> = {
  pendiente: 'Pendiente',
  aceptado: 'Aceptado',
  vencido: 'Vencido',
  convertido: 'Convertido en factura',
}

const VARIANTE_ESTADO: Readonly<Record<EstadoPresupuesto, VarianteEtiqueta>> = {
  pendiente: 'neutral',
  aceptado: 'exito',
  vencido: 'error',
  convertido: 'primario',
}

export const etiquetaEstadoPresupuesto = (estado: string) => ETIQUETA_ESTADO[estado as EstadoPresupuesto] ?? estado
export const varianteEstadoPresupuesto = (estado: string): VarianteEtiqueta => VARIANTE_ESTADO[estado as EstadoPresupuesto] ?? 'neutral'

export type Presupuesto = {
  id: string
  numero: string
  empresa_id: string
  empresa: string
  fecha: string
  cliente: string
  operador: string
  valido_hasta: string | null
  estado: string
  total: number
  puede_editar: boolean
}

export type PaginaPresupuestos = { presupuestos: Presupuesto[]; total: number }

// Aceptar y modificar (misma regla) solo valen mientras el presupuesto está pendiente (FR-050, FR-052, FR-055). Copiar vale
// en cualquier estado: es la forma de renovar un presupuesto vencido o repetir uno aceptado.
export const puedeAceptarOModificarPresupuesto = (p: Pick<Presupuesto, 'estado' | 'puede_editar'>) => p.puede_editar && p.estado === 'pendiente'
export const puedeCopiarPresupuesto = (p: Pick<Presupuesto, 'puede_editar'>) => p.puede_editar

export type ParametrosListadoPresupuestos = {
  busqueda: string
  estado: FiltroEstadoPresupuesto
  empresaId: string | null
  pagina: number
  tamano: number
}

type FilaListado = Omit<Presupuesto, 'total'> & { total: number | string; filas: number | string }

export async function listarPresupuestos(parametros: ParametrosListadoPresupuestos): Promise<PaginaPresupuestos> {
  const texto = parametros.busqueda.trim()
  const { data, error } = await supabaseClient.rpc('listar_presupuestos', {
    p_busqueda: texto === '' ? null : texto,
    p_estado: parametros.estado === 'todos' ? null : parametros.estado,
    p_empresa_id: parametros.empresaId,
    p_pagina: parametros.pagina,
    p_tamano: parametros.tamano,
  })
  if (error) throw error
  const filas = (data ?? []) as FilaListado[]
  return {
    presupuestos: filas.map(({ filas: _filas, total, ...resto }) => ({ ...resto, total: Number(total) })),
    total: filas.length > 0 ? Number(filas[0].filas) : 0,
  }
}

export type PresupuestoResultado = { id: string; numero: string; estado: string }

function aResultado(dato: unknown): PresupuestoResultado {
  const fila = dato as Partial<PresupuestoResultado> | null
  if (!fila || typeof fila.id !== 'string' || typeof fila.numero !== 'string') {
    throw new Error('La base no devolvió el presupuesto')
  }
  return { id: fila.id, numero: fila.numero, estado: String(fila.estado ?? '') }
}

export async function aceptarPresupuesto(id: string): Promise<PresupuestoResultado> {
  const { data, error } = await supabaseClient.rpc('aceptar_presupuesto', { p_id: id })
  if (error) throw error
  return aResultado(data)
}

export async function copiarPresupuesto(id: string): Promise<PresupuestoResultado> {
  const { data, error } = await supabaseClient.rpc('copiar_presupuesto', { p_id: id })
  if (error) throw error
  return aResultado(data)
}
