import { supabaseClient } from './supabase'
import { mensajeDeErrorComprobante } from './ventas'
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

// Canal del presupuesto (MSF-942): `panel` lo cargó el equipo; `tienda` lo pidió un cliente desde la tienda online. La base lo deriva del vínculo real
// (`dominio.presupuestos_tienda`) y lo filtra ANTES de paginar y contar, así `total` y las tandas son correctos.
export type FiltroOrigenPresupuesto = 'todos' | 'panel' | 'tienda'

export const FILTROS_ORIGEN: ReadonlyArray<{ valor: FiltroOrigenPresupuesto; etiqueta: string }> = [
  { valor: 'todos', etiqueta: 'Todos los canales' },
  { valor: 'panel', etiqueta: 'Panel' },
  { valor: 'tienda', etiqueta: 'Tienda online' },
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
// Facturar (decisión de producto): solo un presupuesto ACEPTADO y no vencido, con `ventas` en edición en su tienda. La base lo
// exige igual (`facturar_presupuesto`); acá solo decide si se ofrece el botón. «Vencido» de un aceptado no lo deriva el listado
// (solo vence el pendiente), por eso se compara `valido_hasta` con hoy en Buenos Aires, igual que la base.
export function hoyEnArgentina(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora)
}
export const puedeFacturarPresupuesto = (
  p: Pick<Presupuesto, 'estado' | 'puede_editar' | 'valido_hasta'>,
  hoy: string = hoyEnArgentina(),
) => p.puede_editar && p.estado === 'aceptado' && (p.valido_hasta === null || p.valido_hasta >= hoy)
export const puedeCopiarPresupuesto = (p: Pick<Presupuesto, 'puede_editar'>) => p.puede_editar

export type ParametrosListadoPresupuestos = {
  busqueda: string
  estado: FiltroEstadoPresupuesto
  origen?: FiltroOrigenPresupuesto
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
    p_origen: parametros.origen === undefined || parametros.origen === 'todos' ? null : parametros.origen,
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

// `aceptar_presupuesto` rechaza con 55000 y un texto propio. Se devuelve SIEMPRE la constante del catálogo que coincide
// con el texto de la RPC (nunca el `message` del servidor); cualquier otro 55000 cae al genérico de comprobantes.
const MENSAJES_ACEPTAR_DE_LA_RPC = [
  'El presupuesto está vencido y no se puede aceptar',
  'Este presupuesto ya no se puede aceptar',
] as const

export function mensajeDeAceptarPresupuesto(error: unknown, porDefecto: string): string {
  const e = error as { code?: string; message?: unknown } | null
  const conocido =
    e?.code === '55000' && typeof e.message === 'string'
      ? MENSAJES_ACEPTAR_DE_LA_RPC.find((m) => (e.message as string).startsWith(m))
      : undefined
  if (conocido) {
    console.error(porDefecto, e?.code)
    return conocido
  }
  return mensajeDeErrorComprobante(error, porDefecto)
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

// Facturar presupuesto: crea la factura en borrador con los precios del presupuesto (congelados) y lo marca convertido. Es
// idempotente: facturar uno ya convertido devuelve la misma factura (doble clic, reintento).
export async function facturarPresupuesto(id: string): Promise<PresupuestoResultado> {
  const { data, error } = await supabaseClient.rpc('facturar_presupuesto', { p_presupuesto_id: id })
  if (error) throw error
  return aResultado(data)
}

// Textos de la RPC que se muestran tal cual: los fija la base y son accionables (nunca el `message` desconocido del servidor).
const MENSAJES_FACTURAR_DE_LA_RPC = [
  'Aceptá el presupuesto antes de facturarlo',
  'El presupuesto está vencido y no se puede facturar',
  'Este presupuesto ya no se puede facturar',
  'El presupuesto no tiene líneas para facturar',
  'El cliente del presupuesto ya no está disponible',
  'La tienda del presupuesto está desactivada',
  'Tu rol no puede facturar presupuestos de esta tienda',
] as const
const PRODUCTO_INACTIVO_FACTURAR = /^El producto «[^»\n]{1,200}» ya no está activo: reactivalo para facturar el presupuesto$/

export function mensajeDeFacturarPresupuesto(error: unknown, porDefecto: string): string {
  const e = error as { code?: string; message?: unknown } | null
  const mensaje = typeof e?.message === 'string' ? e.message : ''
  const esDeNegocio = e?.code === '55000' || e?.code === '22023' || e?.code === '42501'
  if (esDeNegocio) {
    const conocido = MENSAJES_FACTURAR_DE_LA_RPC.find((m) => mensaje === m)
    if (conocido) {
      console.error(porDefecto, e?.code)
      return conocido
    }
    if (e?.code === '22023' && PRODUCTO_INACTIVO_FACTURAR.test(mensaje)) {
      console.error(porDefecto, e.code)
      return mensaje
    }
  }
  return mensajeDeErrorComprobante(error, porDefecto)
}

export type VinculoPresupuesto = {
  presupuesto_id: string
  presupuesto_numero: string
  factura_id: string
  factura_numero: string
  factura_estado: string
}

// Vínculo presupuesto <-> factura de un comprobante (la factura de un presupuesto convertido o el presupuesto de origen de una
// factura). Sin vínculo (o sin acceso) devuelve null.
export async function obtenerVinculoPresupuesto(id: string): Promise<VinculoPresupuesto | null> {
  const { data, error } = await supabaseClient.rpc('obtener_vinculo_presupuesto', { p_id: id })
  if (error) throw error
  const filas = (data ?? []) as VinculoPresupuesto[]
  return filas.length > 0 ? filas[0] : null
}
