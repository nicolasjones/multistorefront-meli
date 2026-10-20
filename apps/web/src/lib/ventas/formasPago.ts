// Formas de pago por empresa (F-VTA-01, MSF-210, FR-001/FR-002). El esquema, los valores permitidos
// y las RPC viven en las migraciones 20261020100000_formas_pago.sql y 20261020100100_formas_pago_rpc.sql;
// acá se espejan para validar antes de viajar (la autoridad es la base).
import { supabaseClient } from '../supabase'

export const TIPOS_FORMA_PAGO = ['efectivo', 'transferencia', 'contrarreembolso', 'tarjeta', 'otro'] as const
export type TipoFormaPago = (typeof TIPOS_FORMA_PAGO)[number]

export const ETIQUETA_TIPO_FORMA_PAGO: Readonly<Record<TipoFormaPago, string>> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia o depósito bancario',
  contrarreembolso: 'Contrarreembolso',
  tarjeta: 'Tarjeta',
  otro: 'Otro',
}

export const ESTADOS_INICIALES = ['pendiente', 'aceptado', 'cobrado', 'deuda'] as const
export type EstadoInicialComprobante = (typeof ESTADOS_INICIALES)[number]

export const ETIQUETA_ESTADO_INICIAL: Readonly<Record<EstadoInicialComprobante, string>> = {
  pendiente: 'Pendiente',
  aceptado: 'Aceptado',
  cobrado: 'Cobrado',
  deuda: 'Deuda',
}

export const NOMBRE_MAXIMO = 100
export const ORDEN_MAXIMO = 9999

// Fila de dominio.formas_pago tal como la lee la pestaña.
export type FormaPago = {
  id: string
  empresa_id: string
  nombre: string
  tipo: TipoFormaPago
  exige_cuenta_cobro: boolean
  genera_deuda: boolean
  estado_inicial: EstadoInicialComprobante
  orden: number
  activo: boolean
  updated_at: string
}

export const COLUMNAS_FORMA_PAGO =
  'id, empresa_id, nombre, tipo, exige_cuenta_cobro, genera_deuda, estado_inicial, orden, activo, updated_at'

export type FormularioFormaPago = {
  nombre: string
  tipo: TipoFormaPago
  exigeCuentaCobro: boolean
  generaDeuda: boolean
  estadoInicial: EstadoInicialComprobante
  // Texto del campo: se valida y convierte al enviar.
  orden: string
  activo: boolean
  // Solo en el alta: una forma independiente por empresa marcada.
  empresaIds: string[]
}

export type CampoFormaPago = 'nombre' | 'orden' | 'empresaIds'
export type ErroresFormaPago = Partial<Record<CampoFormaPago, string>>

export const MENSAJE_NOMBRE_VACIO = 'Completá el nombre'
export const MENSAJE_NOMBRE_REPETIDO = 'Ya existe una forma de pago con ese nombre en esa empresa.'
export const MENSAJE_CONFLICTO =
  'Otra persona modificó esta forma de pago mientras la editabas. Recargá para ver sus cambios; no se guardó nada tuyo.'

export function formularioVacio(empresaId: string, orden: number): FormularioFormaPago {
  return {
    nombre: '',
    tipo: 'efectivo',
    exigeCuentaCobro: false,
    generaDeuda: false,
    estadoInicial: 'pendiente',
    orden: String(orden),
    activo: true,
    empresaIds: [empresaId],
  }
}

export function aFormulario(forma: FormaPago): FormularioFormaPago {
  return {
    nombre: forma.nombre,
    tipo: forma.tipo,
    exigeCuentaCobro: forma.exige_cuenta_cobro,
    generaDeuda: forma.genera_deuda,
    estadoInicial: forma.estado_inicial,
    orden: String(forma.orden),
    activo: forma.activo,
    empresaIds: [forma.empresa_id],
  }
}

// `orden` viaja como entero; null = el texto no es un entero entre 0 y ORDEN_MAXIMO.
export function ordenComoEntero(texto: string): number | null {
  const limpio = texto.trim()
  if (!/^\d+$/.test(limpio)) return null
  const valor = Number(limpio)
  return valor <= ORDEN_MAXIMO ? valor : null
}

export function validarFormaPago(formulario: FormularioFormaPago, { alta }: { alta: boolean }): ErroresFormaPago {
  const errores: ErroresFormaPago = {}
  const nombre = formulario.nombre.trim()
  if (nombre === '') {
    errores.nombre = MENSAJE_NOMBRE_VACIO
  } else if (nombre.length > NOMBRE_MAXIMO) {
    errores.nombre = `Máximo ${NOMBRE_MAXIMO} caracteres.`
  }
  if (ordenComoEntero(formulario.orden) === null) {
    errores.orden = `El orden es un número entero entre 0 y ${ORDEN_MAXIMO}.`
  }
  if (alta && formulario.empresaIds.length === 0) {
    errores.empresaIds = 'Elegí al menos una empresa.'
  }
  return errores
}

type ErrorBase = { code?: string } | null

export function esConflicto(error: unknown): boolean {
  return (error as ErrorBase)?.code === '40001'
}

// El mensaje crudo de Postgres/PostgREST puede nombrar políticas, índices o columnas: al usuario va
// solo el texto en castellano y el detalle queda en consola.
export function mensajeDeError(error: unknown, porDefecto: string): string {
  console.error(porDefecto, (error as ErrorBase)?.code ?? 'sin código')
  const code = (error as ErrorBase)?.code
  if (code === '40001') return MENSAJE_CONFLICTO
  if (code === 'P0002') return 'La forma de pago ya no existe o no pertenece a tu organización.'
  if (code === '42501') return 'No tenés permiso para esta acción. Puede que tu rol haya cambiado: recargá la página.'
  // Único (empresa, nombre) es la única restricción 23505 de la tabla.
  if (code === '23505') return MENSAJE_NOMBRE_REPETIDO
  if (code === '22023' || code === '23514') return 'Algún dato no es válido. Revisá el formulario e intentá de nuevo.'
  return porDefecto
}

// Orden del catálogo: primero el `orden` cargado, después el nombre.
export async function listarFormasPago(empresaId: string): Promise<FormaPago[]> {
  const { data, error } = await supabaseClient
    .schema('dominio')
    .from('formas_pago')
    .select(COLUMNAS_FORMA_PAGO)
    .eq('empresa_id', empresaId)
    .order('orden')
    .order('nombre')
    .returns<FormaPago[]>()
  if (error) throw error
  return data ?? []
}

function parametrosComunes(formulario: FormularioFormaPago) {
  return {
    p_nombre: formulario.nombre.trim(),
    p_tipo: formulario.tipo,
    p_exige_cuenta_cobro: formulario.exigeCuentaCobro,
    p_genera_deuda: formulario.generaDeuda,
    p_estado_inicial: formulario.estadoInicial,
    p_orden: ordenComoEntero(formulario.orden),
    p_activo: formulario.activo,
  }
}

// Alta multiempresa: la base crea un ítem independiente por empresa, en una sola transacción.
export async function crearFormaPago(formulario: FormularioFormaPago): Promise<FormaPago[]> {
  const { data, error } = await supabaseClient.rpc('crear_forma_pago', {
    p_empresa_ids: formulario.empresaIds,
    ...parametrosComunes(formulario),
  })
  if (error) throw error
  return (data ?? []) as FormaPago[]
}

// `actualizadoEn` es el updated_at leído al abrir (bloqueo optimista, 40001 ante conflicto).
export async function actualizarFormaPago(
  formulario: FormularioFormaPago,
  datos: { id: string; actualizadoEn: string },
): Promise<FormaPago> {
  const { data, error } = await supabaseClient.rpc('actualizar_forma_pago', {
    p_id: datos.id,
    p_actualizado_en: datos.actualizadoEn,
    ...parametrosComunes(formulario),
  })
  if (error) throw error
  return data as FormaPago
}

export async function cambiarEstadoFormaPago(id: string, activo: boolean): Promise<FormaPago> {
  const { data, error } = await supabaseClient.rpc('cambiar_estado_forma_pago', { p_id: id, p_activo: activo })
  if (error) throw error
  return data as FormaPago
}
