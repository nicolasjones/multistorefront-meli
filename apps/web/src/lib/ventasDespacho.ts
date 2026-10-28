import { supabaseClient } from './supabase'
import type { VarianteEtiqueta } from '../components/base/EtiquetaEstado'

// Estado del despacho de una factura (F-VTA-15, MSF-152, FR-003…FR-011). La autoridad es la base:
// `cambiar_estado_despacho` aplica la máquina de estados (sin_armar → armando → listo_para_despachar → entregado),
// `listar_responsables_despacho` dice quién puede responder por cada paso y `obtener_despacho_comprobante` trae el
// estado y los responsables. Acá solo se nombran los estados, se calcula el próximo paso y se traducen los errores.

export const ESTADOS_DESPACHO = ['sin_armar', 'armando', 'incompleto', 'listo_para_despachar', 'entregado'] as const
export type EstadoDespacho = (typeof ESTADOS_DESPACHO)[number]

export const ETIQUETA_ESTADO_DESPACHO: Readonly<Record<EstadoDespacho, string>> = {
  sin_armar: 'Sin armar',
  armando: 'Armando',
  incompleto: 'Incompleto',
  listo_para_despachar: 'Listo para despachar',
  entregado: 'Entregado',
}

// Texto de ayuda del estado. El de «Entregado» va adaptado a esta épica: el stock normal ya se descontó al
// confirmar la factura (MSF-159, FR-031) y al entregar solo se descuentan las reservas «A pedido».
export const AYUDA_ESTADO_DESPACHO: Readonly<Record<EstadoDespacho, string>> = {
  sin_armar: 'La factura está confirmada y todavía no se armó.',
  armando: 'Se está armando el pedido en el depósito. El stock sigue reservado.',
  incompleto: 'Faltan productos: el armado quedó incompleto.',
  listo_para_despachar: 'El pedido está controlado y listo para salir.',
  entregado: 'El pedido salió: el stock normal ya se descontó al confirmar y ahora se descontaron las reservas «A pedido».',
}

// Paso del despacho al que puede avanzar la factura, con el responsable que lo firma y la acción que lo dispara.
export type FuncionDespacho = 'armar' | 'controlar' | 'entregar'
export type ClaveResponsable = 'armo' | 'controlo' | 'entrego'

export type PasoDespacho = {
  estado: EstadoDespacho
  funcion: FuncionDespacho
  etiqueta: string
  responsable: ClaveResponsable
  etiquetaResponsable: string
}

// El próximo paso de cada estado (Flujo 1). `entregado` es terminal: no hay paso siguiente.
export const PROXIMO_PASO: Readonly<Record<EstadoDespacho, PasoDespacho | null>> = {
  sin_armar: {
    estado: 'armando',
    funcion: 'armar',
    etiqueta: 'Empezar a armar',
    responsable: 'armo',
    etiquetaResponsable: 'Armó',
  },
  incompleto: {
    estado: 'armando',
    funcion: 'armar',
    etiqueta: 'Reanudar el armado',
    responsable: 'armo',
    etiquetaResponsable: 'Armó',
  },
  armando: {
    estado: 'listo_para_despachar',
    funcion: 'controlar',
    etiqueta: 'Controlar',
    responsable: 'controlo',
    etiquetaResponsable: 'Controló',
  },
  listo_para_despachar: {
    estado: 'entregado',
    funcion: 'entregar',
    etiqueta: 'Entregar',
    responsable: 'entrego',
    etiquetaResponsable: 'Entregó',
  },
  entregado: null,
}

export const ETIQUETA_RESPONSABLE: Readonly<Record<ClaveResponsable, string>> = {
  armo: 'Armó',
  controlo: 'Controló',
  entrego: 'Entregó',
}

// Tono del chip del estado de despacho (el mismo criterio que los estados del comprobante).
export const TONO_ESTADO_DESPACHO: Readonly<Record<EstadoDespacho, VarianteEtiqueta>> = {
  sin_armar: 'neutral',
  armando: 'primario',
  incompleto: 'aviso',
  listo_para_despachar: 'info',
  entregado: 'exito',
}

export function proximoPaso(estado: EstadoDespacho | null | undefined): PasoDespacho | null {
  if (!estado) return null
  return PROXIMO_PASO[estado] ?? null
}

// Usuario que puede responder por un paso del despacho (nombre y rol).
export type ResponsableDespacho = {
  user_id: string
  nombre: string
  rol_id: string
}

// Estado del despacho y responsables de un comprobante.
export type DatosDespacho = {
  estado_despacho: EstadoDespacho | null
  armo_id: string | null
  armo: string | null
  controlo_id: string | null
  controlo: string | null
  entrego_id: string | null
  entrego: string | null
  entregado_en: string | null
  updated_at: string
  // Si la sesión puede avanzar el despacho (acción `despachar` de Ventas).
  puede_despachar: boolean
}

export const SIN_RESPONSABLE = 'Sin responsable'

export function etiquetaEstadoDespacho(estado: string | null | undefined): string {
  if (!estado) return 'Sin estado'
  return ETIQUETA_ESTADO_DESPACHO[estado as EstadoDespacho] ?? estado
}

export function ayudaEstadoDespacho(estado: string | null | undefined): string {
  if (!estado) return 'Esta factura todavía no entró al despacho.'
  return AYUDA_ESTADO_DESPACHO[estado as EstadoDespacho] ?? ''
}

// Nombre del responsable ya registrado de un paso (o «Sin responsable»).
export function nombreResponsable(datos: DatosDespacho | null, clave: ClaveResponsable): string {
  if (!datos) return SIN_RESPONSABLE
  const nombre = clave === 'armo' ? datos.armo : clave === 'controlo' ? datos.controlo : datos.entrego
  return nombre ?? SIN_RESPONSABLE
}

export function idResponsable(datos: DatosDespacho | null, clave: ClaveResponsable): string | null {
  if (!datos) return null
  return clave === 'armo' ? datos.armo_id : clave === 'controlo' ? datos.controlo_id : datos.entrego_id
}

type ErrorDeBase = { code?: string; message?: string } | null

export const MENSAJE_ERROR_DESPACHO = 'No pudimos cambiar el estado del despacho. No se guardó nada: probá de nuevo.'
export const MENSAJE_ERROR_CARGA_DESPACHO = 'No pudimos cargar el despacho de esta factura. Probá de nuevo.'
export const MENSAJE_CONFLICTO_DESPACHO =
  'Otra persona modificó este comprobante mientras lo mirabas. Recargamos los datos: volvé a elegir el responsable.'
export const MENSAJE_SIN_DESPACHO = 'Podés ver el estado y los responsables, pero tu rol no puede avanzar el despacho.'
export const MENSAJE_SIN_ESTADO_DESPACHO = 'Esta factura todavía no entró al despacho.'
export const MENSAJE_EXITO_DESPACHO = 'Despacho actualizado.'
export const PLACEHOLDER_RESPONSABLE = 'Seleccionar'

// Los mensajes que levanta la RPC llegan en castellano y se muestran tal cual; el resto se traduce por código.
const PREFIJOS_MENSAJE_DE_LA_RPC = [
  'Necesitás una sesión',
  'Tu rol ',
  'Esa persona no puede',
  'Quien armó',
  'Una factura ',
  'Elegí quién',
  'El estado "',
  'Solo las facturas',
  'Esta factura todavía',
  'Un presupuesto no entra',
  'Alguien modificó',
  'La reserva de la línea',
  'No encontramos la reserva',
] as const

function esMensajeDeLaRpc(error: ErrorDeBase): error is { message: string } {
  const mensaje = error?.message
  return typeof mensaje === 'string' && PREFIJOS_MENSAJE_DE_LA_RPC.some((prefijo) => mensaje.startsWith(prefijo))
}

export function mensajeDeErrorDespacho(error: unknown): string {
  const e = error as ErrorDeBase
  console.error(MENSAJE_ERROR_DESPACHO, e?.code ?? 'sin código')
  if (e?.code === '40001') return MENSAJE_CONFLICTO_DESPACHO
  if ((e?.code === '42501' || e?.code === '55000' || e?.code === '22023') && esMensajeDeLaRpc(e)) return e.message
  if (e?.code === 'P0002') return 'Ese comprobante no existe o no pertenece a tu organización.'
  return MENSAJE_ERROR_DESPACHO
}

// Estado del despacho y responsables: lo que muestra la tarjeta «Responsables».
export async function obtenerDespachoComprobante(id: string): Promise<DatosDespacho> {
  const { data, error } = await supabaseClient.rpc('obtener_despacho_comprobante', { p_id: id })
  if (error) throw error
  const fila = (data ?? {}) as Partial<DatosDespacho>
  return {
    estado_despacho: fila.estado_despacho ?? null,
    armo_id: fila.armo_id ?? null,
    armo: fila.armo ?? null,
    controlo_id: fila.controlo_id ?? null,
    controlo: fila.controlo ?? null,
    entrego_id: fila.entrego_id ?? null,
    entrego: fila.entrego ?? null,
    entregado_en: fila.entregado_en ?? null,
    updated_at: fila.updated_at ?? '',
    puede_despachar: fila.puede_despachar === true,
  }
}

// Quién puede responder por un paso del despacho en una tienda.
export async function listarResponsablesDespacho(
  empresaId: string,
  funcion: FuncionDespacho,
): Promise<ResponsableDespacho[]> {
  const { data, error } = await supabaseClient.rpc('listar_responsables_despacho', {
    p_empresa_id: empresaId,
    p_funcion: funcion,
  })
  if (error) throw error
  return (Array.isArray(data) ? data : []) as ResponsableDespacho[]
}

// Avanza el despacho. `actualizadoEn` es el updated_at leído al abrir (bloqueo optimista, 40001 ante conflicto).
export async function cambiarEstadoDespacho(datos: {
  id: string
  estado: EstadoDespacho
  responsableId: string
  actualizadoEn: string
}): Promise<void> {
  const { error } = await supabaseClient.rpc('cambiar_estado_despacho', {
    p_id: datos.id,
    p_estado: datos.estado,
    p_responsable_id: datos.responsableId,
    p_actualizado_en: datos.actualizadoEn,
  })
  if (error) throw error
}
