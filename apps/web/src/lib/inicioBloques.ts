import { supabaseClient } from './supabase'
import type { EventoActividadListado } from './actividad'

// Bloques de gestión y listado «Movimientos por producto» de Inicio (F-INI-05 MSF-821, F-INI-06 MSF-822).
// La base decide qué ve cada rol: `por_tienda` / `salidas_por_deposito` vuelven null sin permiso, `ingresos` y
// `margen_pct` vuelven null sin `rentabilidad`, y la columna `ventas` del listado vuelve null sin `ventas`.
// Acá solo se rotulan los números; nunca se calcula costo ni margen en el navegador.

export type RangoTablero = { desde: string; hasta: string }
export type ContextoTablero = RangoTablero & { empresaId: string | null; depositoId: string | null }

export type TiendaResumen = {
  empresa_id: string
  nombre: string
  unidades: number
  ingresos: number | null
  margen_pct: number | null
}

export type DepositoSalidas = { deposito_id: string; nombre: string; salidas: number; stock_actual: number }

export type BloquesInicio = {
  por_tienda: TiendaResumen[] | null
  salidas_por_deposito: DepositoSalidas[] | null
}

export async function leerBloquesInicio({ desde, hasta, empresaId, depositoId }: ContextoTablero): Promise<BloquesInicio> {
  const { data, error } = await supabaseClient.rpc('resumen_inicio_bloques', {
    p_desde: desde,
    p_hasta: hasta,
    p_empresa: empresaId,
    p_deposito: depositoId,
  })
  if (error) throw error
  return data as BloquesInicio
}

// «Actividad reciente»: los últimos eventos del período con `listar_actividad` (security invoker: la RLS de
// `registro_actividad` decide quién ve qué). No lleva depósito: el registro de actividad no lo guarda.
export const EVENTOS_RECIENTES = 10

type FilaActividad = {
  id: string
  creado_en: string
  tipo: string
  empresa_id: string | null
  empresa_nombre: string | null
  actor_id: string | null
  actor_nombre: string | null
  detalle: string
}

export async function leerActividadReciente({ desde, hasta, empresaId }: ContextoTablero): Promise<EventoActividadListado[]> {
  const { data, error } = await supabaseClient.rpc('listar_actividad', {
    p_desde: desde,
    p_hasta: hasta,
    p_empresa: empresaId,
    p_actor: null,
    p_tipo: null,
    p_texto: null,
    p_pagina: 1,
    p_tamano: EVENTOS_RECIENTES,
  })
  if (error) throw error
  return ((data ?? []) as FilaActividad[]).map((fila) => ({
    id: fila.id,
    creadoEn: fila.creado_en,
    tipo: fila.tipo,
    empresaId: fila.empresa_id,
    empresaNombre: fila.empresa_nombre,
    actorId: fila.actor_id,
    actorNombre: fila.actor_nombre,
    detalle: fila.detalle,
  }))
}

// ---- Movimientos por producto (F-INI-06) ----

export type VistaMovimientos = 'todos' | 'alerta' | 'quieto'
export type EstadoMovimiento = 'alerta' | 'quieto' | 'normal'
export type ClaveOrdenMovimientos =
  | 'nombre' | 'sku' | 'categoria' | 'stock_inicial' | 'entradas' | 'salidas' | 'ajustes'
  | 'stock_actual' | 'minimo' | 'ventas' | 'ultimo_movimiento' | 'estado'
export type DireccionOrden = 'asc' | 'desc'

export const VISTAS_MOVIMIENTOS: ReadonlyArray<{ valor: VistaMovimientos; etiqueta: string }> = [
  { valor: 'todos', etiqueta: 'Todos' },
  { valor: 'alerta', etiqueta: 'En alerta' },
  { valor: 'quieto', etiqueta: 'Quietos' },
]

export const ORDENES_MOVIMIENTOS: ReadonlyArray<{ valor: ClaveOrdenMovimientos; etiqueta: string }> = [
  { valor: 'nombre', etiqueta: 'Producto' },
  { valor: 'sku', etiqueta: 'SKU' },
  { valor: 'categoria', etiqueta: 'Categoría' },
  { valor: 'stock_inicial', etiqueta: 'Stock inicial' },
  { valor: 'entradas', etiqueta: 'Entradas' },
  { valor: 'salidas', etiqueta: 'Salidas' },
  { valor: 'ajustes', etiqueta: 'Ajustes' },
  { valor: 'stock_actual', etiqueta: 'Stock actual' },
  { valor: 'minimo', etiqueta: 'Mínimo' },
  { valor: 'ventas', etiqueta: 'Ventas' },
  { valor: 'ultimo_movimiento', etiqueta: 'Último movimiento' },
  { valor: 'estado', etiqueta: 'Estado' },
]

export const ETIQUETA_ESTADO_MOVIMIENTO: Readonly<Record<EstadoMovimiento, string>> = {
  alerta: 'En alerta',
  quieto: 'Quieto',
  normal: 'Normal',
}

export type FiltrosMovimientos = {
  busqueda: string
  categoriaId: string | null
  vista: VistaMovimientos
  orden: ClaveOrdenMovimientos
  direccion: DireccionOrden
}

export const FILTROS_MOVIMIENTOS_INICIALES: FiltrosMovimientos = {
  busqueda: '',
  categoriaId: null,
  vista: 'todos',
  orden: 'nombre',
  direccion: 'asc',
}

export type MovimientoProducto = {
  productoId: string
  nombre: string
  sku: string | null
  categoria: string
  stockInicial: number
  entradas: number
  salidas: number
  ajustes: number
  stockActual: number
  minimo: number
  // null = el rol no tiene `ventas` (la columna no se muestra).
  ventas: number | null
  ultimoMovimiento: string | null
  estado: EstadoMovimiento
}

type FilaMovimiento = {
  producto_id: string
  nombre: string
  sku: string | null
  categoria: string
  stock_inicial: number | string
  entradas: number | string
  salidas: number | string
  ajustes: number | string
  stock_actual: number | string
  minimo: number | string
  ventas: number | string | null
  ultimo_movimiento: string | null
  estado: EstadoMovimiento
  total: number | string
}

export const TAMANO_PAGINA_MOVIMIENTOS = 25
// Máximo de la RPC por página; también el tamaño de lote de la exportación.
export const TAMANO_LOTE_EXPORTACION = 100

export async function leerMovimientosPorProducto(
  contexto: ContextoTablero,
  filtros: FiltrosMovimientos,
  pagina: number,
  tamano: number,
): Promise<{ filas: MovimientoProducto[]; total: number }> {
  const busqueda = filtros.busqueda.trim()
  const { data, error } = await supabaseClient.rpc('movimientos_por_producto', {
    p_desde: contexto.desde,
    p_hasta: contexto.hasta,
    p_empresa: contexto.empresaId,
    p_deposito: contexto.depositoId,
    p_busqueda: busqueda === '' ? null : busqueda,
    p_categoria: filtros.categoriaId,
    p_vista: filtros.vista,
    p_orden: filtros.orden,
    p_direccion: filtros.direccion,
    p_pagina: pagina,
    p_tamano: tamano,
  })
  if (error) throw error
  const filas = (data ?? []) as FilaMovimiento[]
  return {
    total: filas.length > 0 ? Number(filas[0].total) : 0,
    filas: filas.map((fila) => ({
      productoId: fila.producto_id,
      nombre: fila.nombre,
      sku: fila.sku && fila.sku.trim() !== '' ? fila.sku : null,
      categoria: fila.categoria,
      stockInicial: Number(fila.stock_inicial),
      entradas: Number(fila.entradas),
      salidas: Number(fila.salidas),
      ajustes: Number(fila.ajustes),
      stockActual: Number(fila.stock_actual),
      minimo: Number(fila.minimo),
      ventas: fila.ventas === null ? null : Number(fila.ventas),
      ultimoMovimiento: fila.ultimo_movimiento,
      estado: fila.estado,
    })),
  }
}

// Ajustes con signo explícito (+3 / −2); el resto de las cantidades, enteros planos.
export function formatoAjuste(valor: number): string {
  if (valor === 0) return '0'
  return `${valor > 0 ? '+' : '−'}${Math.abs(valor)}`
}

// `2026-10-10` → `10/10/2026` (la fecha ya viene como día de la organización; no se pasa por Date).
export function formatoDia(dia: string | null): string {
  if (!dia) return '—'
  const [anio, mes, diaMes] = dia.split('-')
  return anio && mes && diaMes ? `${diaMes}/${mes}/${anio}` : dia
}
