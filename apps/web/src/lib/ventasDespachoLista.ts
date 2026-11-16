import { supabaseClient } from './supabase'
import { ESTADOS_DESPACHO, type EstadoDespacho } from './ventasDespacho'
import type { VarianteEtiqueta } from '../components/base/EtiquetaEstado'

// Tablero de despacho (F-VTA-17, MSF-183, épica MSF-135, FR-030 y FR-031).
//
// La autoridad es la base: `listar_despacho` (migración 20270112150000) trae las facturas confirmadas no
// anuladas de las tiendas donde la persona tiene Ventas, con su estado de despacho, responsables, transporte y
// guía, filtradas, paginadas y con el conteo por estado. Acá solo se nombran los tipos y se envuelve la RPC.

/** Una fila del tablero (una factura por despachar). */
export type FilaDespacho = {
  id: string
  /** Número del comprobante («0003-00001251»). */
  numero: string
  empresa_id: string
  /** Tienda de la factura. */
  empresa: string
  fecha: string
  cliente: string
  estado_despacho: EstadoDespacho
  /** Quién armó, controló y entregó (null si ese paso todavía no se dio). */
  armo: string | null
  controlo: string | null
  entrego: string | null
  transporte: string | null
  guia: string | null
  fecha_envio: string | null
  /** Si la sesión puede avanzar esta factura (acción `despachar` en SU tienda). */
  puede_despachar: boolean
}

export type ConteosDespacho = Readonly<Record<EstadoDespacho, number>>

export type PaginaDespacho = {
  filas: FilaDespacho[]
  /** Total de facturas que cumplen el filtro actual (todas las páginas). */
  total: number
  /** Facturas por estado dentro de la tienda y la búsqueda, sin el filtro de estado. */
  conteos: ConteosDespacho
}

export const CONTEOS_VACIOS: ConteosDespacho = {
  sin_armar: 0,
  armando: 0,
  incompleto: 0,
  listo_para_despachar: 0,
  entregado: 0,
}

/** Tono de la etiqueta de cada estado de despacho. */
export const VARIANTE_ESTADO_DESPACHO: Readonly<Record<EstadoDespacho, VarianteEtiqueta>> = {
  sin_armar: 'neutral',
  armando: 'info',
  incompleto: 'aviso',
  listo_para_despachar: 'primario',
  entregado: 'exito',
}

type FilaCruda = Omit<FilaDespacho, 'id'> & {
  // Nulo en la fila "sin facturas": la base devuelve una sola fila con los conteos cuando la página queda vacía.
  id: string | null
  filas: number | string
  conteos: Partial<Record<EstadoDespacho, number | string>> | null
}

/** Las cuentas por estado que devuelve la base, completadas con cero para los estados sin facturas. */
export function normalizarConteos(crudos: FilaCruda['conteos']): ConteosDespacho {
  const conteos = { ...CONTEOS_VACIOS } as Record<EstadoDespacho, number>
  for (const estado of ESTADOS_DESPACHO) conteos[estado] = Number(crudos?.[estado] ?? 0)
  return conteos
}

export type FiltrosDespacho = {
  busqueda: string
  /** Estado por el que filtrar; null = todos. */
  estado: EstadoDespacho | null
  /** Tienda por la que filtrar; null = todas. */
  empresaId: string | null
  pagina: number
  tamano: number
}

/** Facturas por despachar de las tiendas accesibles, paginadas en el servidor. */
export async function listarDespacho({ busqueda, estado, empresaId, pagina, tamano }: FiltrosDespacho): Promise<PaginaDespacho> {
  const { data, error } = await supabaseClient.rpc('listar_despacho', {
    p_busqueda: busqueda.trim() === '' ? null : busqueda.trim(),
    p_estado: estado,
    p_empresa_id: empresaId,
    p_pagina: pagina,
    p_tamano: tamano,
  })
  if (error) throw error
  const crudas = (data ?? []) as FilaCruda[]
  return {
    filas: crudas
      .filter((cruda): cruda is FilaCruda & { id: string } => cruda.id !== null)
      .map(({ filas: _filas, conteos: _conteos, ...fila }) => fila),
    total: crudas.length > 0 ? Number(crudas[0].filas) : 0,
    conteos: normalizarConteos(crudas[0]?.conteos),
  }
}
