import { supabaseClient } from './supabase'
import type { VarianteEtiqueta } from '../components/base/EtiquetaEstado'

// Estados del comprobante y de cobro (F-VTA-10, MSF-365, FR-023). Único catálogo de etiquetas, tonos y textos de
// ayuda del frontend: la pantalla del detalle, el listado y los filtros lo reutilizan. La autoridad de las
// transiciones es la base (`cambiar_estado_comprobante`, matriz por rol); acá solo se nombran y se llaman.
// «Entregado» (visible en el prototipo) es de MSF-135 y no se entrega acá.

export type EstadoComprobante =
  | 'borrador'
  | 'confirmada'
  | 'pendiente'
  | 'aceptado'
  | 'cobrado'
  | 'en_proceso'
  | 'deuda'
  | 'armando'
  | 'incompleto'
  | 'anulada'

type DefinicionEstado = { etiqueta: string; tono: VarianteEtiqueta; ayuda: string }

export const ESTADOS_COMPROBANTE: Record<EstadoComprobante, DefinicionEstado> = {
  borrador: { etiqueta: 'Borrador', tono: 'neutral', ayuda: 'Todavía no se confirmó: no descuenta ni reserva stock.' },
  // `confirmada` (MSF-159) se muestra «Pendiente»: evita cambiar lo ya entregado de `confirmar_comprobante`.
  confirmada: { etiqueta: 'Pendiente', tono: 'neutral', ayuda: 'Creado: el stock queda reservado, todavía no se descuenta.' },
  pendiente: { etiqueta: 'Pendiente', tono: 'neutral', ayuda: 'Creado: el stock queda reservado, todavía no se descuenta.' },
  aceptado: { etiqueta: 'Aceptado', tono: 'contorno', ayuda: 'El cliente aceptó el presupuesto.' },
  cobrado: { etiqueta: 'Cobrado', tono: 'exito', ayuda: 'Pago recibido y conciliado.' },
  en_proceso: { etiqueta: 'En proceso', tono: 'info', ayuda: 'En gestión: pago o envío en curso.' },
  deuda: { etiqueta: 'Deuda', tono: 'error', ayuda: 'Entregado o facturado sin cobrar.' },
  armando: { etiqueta: 'Armando', tono: 'primario', ayuda: 'Se está armando el pedido en el depósito elegido. El stock sigue reservado.' },
  incompleto: { etiqueta: 'Incompleto', tono: 'aviso', ayuda: 'Faltan productos: los faltantes quedan en Ventas · Faltantes.' },
  anulada: { etiqueta: 'Anulada', tono: 'contorno', ayuda: 'El documento dejó de valer: no admite cambios.' },
}

// Estados que muestra la tarjeta «Estado» del detalle, en el orden del prototipo. «Pendiente» se identifica con el
// estado guardado en la base (`confirmada`).
export const ESTADOS_DE_LA_TARJETA: ReadonlyArray<EstadoComprobante> = [
  'confirmada',
  'aceptado',
  'cobrado',
  'en_proceso',
  'deuda',
  'armando',
  'incompleto',
]

const ESTADOS_DE_COBRO: ReadonlyArray<string> = ['cobrado', 'deuda']

export const esEstadoDeCobro = (estado: string): boolean => ESTADOS_DE_COBRO.includes(estado)

export function definicionEstado(estado: string): DefinicionEstado {
  return ESTADOS_COMPROBANTE[estado as EstadoComprobante] ?? { etiqueta: estado, tono: 'neutral', ayuda: '' }
}

export const etiquetaEstadoComprobante = (estado: string): string => definicionEstado(estado).etiqueta

export const MOTIVO_ESTADO_DE_COBRO = 'Se actualiza solo con el cobro del comprobante.'
export const MOTIVO_ESTADO_BORRADOR = 'Confirmá la factura antes de cambiar su estado.'
export const MOTIVO_ESTADO_ANULADA = 'La factura está anulada y no admite cambios de estado.'

// Por qué un chip de la tarjeta está deshabilitado (null = se puede elegir). `permitidos` son los estados a los que
// el rol puede pasar desde el actual, tal como los informa la base.
export function motivoDeshabilitado(actual: string, destino: EstadoComprobante, permitidos: ReadonlyArray<string>): string | null {
  if (actual === destino) return null
  if (actual === 'borrador') return MOTIVO_ESTADO_BORRADOR
  if (actual === 'anulada') return MOTIVO_ESTADO_ANULADA
  if (esEstadoDeCobro(destino)) return MOTIVO_ESTADO_DE_COBRO
  if (permitidos.includes(destino)) return null
  return `Tu rol no puede pasar de ${etiquetaEstadoComprobante(actual)} a ${etiquetaEstadoComprobante(destino)}.`
}

export type EventoHistorial = {
  cuando: string
  accion: string
  quien: string
  empresa_id: string | null
  empresa: string | null
}

export const MENSAJE_ERROR_CAMBIO_ESTADO = 'No pudimos cambiar el estado. No se guardó nada: probá de nuevo.'
export const MENSAJE_CONFLICTO_ESTADO =
  'Otra persona modificó este comprobante mientras lo mirabas. Recargamos los datos: volvé a elegir el estado.'

type ErrorDeBase = { code?: string; message?: string } | null

export const esConflictoDeEstado = (error: unknown): boolean => (error as ErrorDeBase)?.code === '40001'

// Solo los mensajes que levanta nuestra RPC llegan en castellano y se muestran tal cual. Un 42501/55000/22023 de
// PostgREST (p. ej. «permission denied for function …») también trae `message`, así que se filtra por el prefijo
// conocido para no exponer detalle técnico en inglés; el conflicto de edición (40001) pide recargar.
const PREFIJOS_MENSAJE_DE_LA_RPC = [
  'Necesitás una sesión con organización para cambiar el estado',
  'Tu rol ',
  'Cobrado y Deuda no se cambian a mano',
  'La factura está en borrador',
  'La factura está anulada',
  'Un presupuesto no tiene estados',
  'El estado "',
] as const

function esMensajeDeLaRpc(error: ErrorDeBase): error is { message: string } {
  const mensaje = error?.message
  return typeof mensaje === 'string' && PREFIJOS_MENSAJE_DE_LA_RPC.some((prefijo) => mensaje.startsWith(prefijo))
}

export function mensajeDeCambioEstado(error: unknown): string {
  const e = error as ErrorDeBase
  console.error(MENSAJE_ERROR_CAMBIO_ESTADO, error)
  if (e?.code === '40001') return MENSAJE_CONFLICTO_ESTADO
  if ((e?.code === '42501' || e?.code === '55000' || e?.code === '22023') && esMensajeDeLaRpc(e)) return e.message
  if (e?.code === 'P0002') return 'Ese comprobante no existe o no pertenece a tu organización.'
  return MENSAJE_ERROR_CAMBIO_ESTADO
}

export async function cambiarEstadoComprobante(
  id: string,
  estado: string,
  actualizadoEn: string,
): Promise<{ estado: string; updated_at: string }> {
  const { data, error } = await supabaseClient.rpc('cambiar_estado_comprobante', {
    p_id: id,
    p_estado: estado,
    p_actualizado_en: actualizadoEn,
  })
  if (error) throw error
  const fila = data as { estado?: string; updated_at?: string } | null
  if (!fila?.estado || !fila.updated_at) throw new Error('La base no devolvió el comprobante actualizado')
  return { estado: fila.estado, updated_at: fila.updated_at }
}

// Estados a los que el rol de la sesión puede pasar el comprobante hoy.
export async function transicionesPermitidas(id: string): Promise<string[]> {
  const { data, error } = await supabaseClient.rpc('transiciones_permitidas_comprobante', { p_id: id })
  if (error) throw error
  return Array.isArray(data) ? (data as string[]) : []
}

export async function historialComprobante(id: string): Promise<EventoHistorial[]> {
  const { data, error } = await supabaseClient.rpc('historial_comprobante', { p_id: id })
  if (error) throw error
  return (Array.isArray(data) ? data : []) as EventoHistorial[]
}
