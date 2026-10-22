import { supabaseClient } from './supabase'
import { parsearImporte } from './serviceTecnico'

// Reparaciones de Service técnico (F-SVC-02 y F-SVC-03). Todas las escrituras y la lectura de una reparación pasan
// por RPC (`crear_reparacion`, `actualizar_reparacion`, `obtener_reparacion`, `cambiar_estado_reparacion`,
// `registrar_entrega_reparacion`, `anular_reparacion`, `historial_reparacion`): la tabla no admite insert/update
// directo y los costos internos solo los devuelve la base con la acción `ver_costos` (FR-021).

export type TipoItemReparacion = 'mano_obra' | 'repuesto'

// Ítem de mano de obra o repuesto (F-SVC-06). `sku` solo en un repuesto vinculado al catálogo.
export type ItemReparacion = {
  id: string
  tipo: TipoItemReparacion
  descripcion: string
  producto_id: string | null
  sku: string | null
  cantidad: number
  precio_unitario: number
  subtotal: number
}

export type Reparacion = {
  id: string
  numero: number
  codigo: string
  empresa_id: string
  empresa: string
  cliente_id: string
  cliente: string
  contacto: string
  modelo_id: string
  equipo: string
  modelo: string
  estado_id: string
  estado: string
  estado_cierra: boolean
  estado_tono: string
  numero_serie: string | null
  accesorios: string
  falla: string
  puede_ver_costos: boolean
  costo_mano_obra: number | null
  costo_repuestos: number | null
  tecnico_id: string | null
  ingreso_en: string
  entrega_prevista: string | null
  entrega_real: string | null
  entregado_por: string | null
  anulada_en: string | null
  anulada_motivo: string | null
  updated_at: string
  items: ItemReparacion[]
  total_mano_obra: number
  total_repuestos: number
  total_cliente: number
  // Solo con `ver_costos`: total al cliente − costos internos. Sin el permiso llega nulo.
  ganancia_estimada: number | null
}

export type Tecnico = { user_id: string; nombre: string }

export type ClienteElegido = { id: string; nombre: string; contacto: string }

export type FormularioReparacion = {
  empresa_id: string
  cliente: ClienteElegido | null
  contacto: string
  equipo: string
  modelo_id: string
  numero_serie: string
  accesorios: string
  falla: string
  costo_mano_obra: string
  costo_repuestos: string
  tecnico_id: string
  ingreso_en: string
  entrega_prevista: string
}

export type CampoReparacion =
  | 'empresa_id'
  | 'cliente_id'
  | 'contacto'
  | 'equipo'
  | 'modelo_id'
  | 'numero_serie'
  | 'accesorios'
  | 'falla'
  | 'costo_mano_obra'
  | 'costo_repuestos'
  | 'tecnico_id'
  | 'ingreso_en'
  | 'entrega_prevista'
export type ErroresReparacion = Partial<Record<CampoReparacion, string>>

export const LARGO_MAXIMO_REPARACION = {
  contacto: 200,
  numero_serie: 100,
  accesorios: 500,
  falla: 1000,
} as const

const CAMPOS: ReadonlyArray<CampoReparacion> = [
  'empresa_id', 'cliente_id', 'contacto', 'equipo', 'modelo_id', 'numero_serie', 'accesorios', 'falla',
  'costo_mano_obra', 'costo_repuestos', 'tecnico_id', 'ingreso_en', 'entrega_prevista',
]

// Fecha de hoy en Argentina (AAAA-MM-DD): es la que usa la base como «ingreso de hoy».
export function hoyEnArgentina(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(ahora)
}

export function formularioVacio(empresaId: string): FormularioReparacion {
  return {
    empresa_id: empresaId,
    cliente: null,
    contacto: '',
    equipo: '',
    modelo_id: '',
    numero_serie: '',
    accesorios: '',
    falla: '',
    costo_mano_obra: '',
    costo_repuestos: '',
    tecnico_id: '',
    ingreso_en: hoyEnArgentina(),
    entrega_prevista: '',
  }
}

export function aFormulario(reparacion: Reparacion): FormularioReparacion {
  const importe = (valor: number | null) => (valor === null ? '' : String(valor).replace('.', ','))
  return {
    empresa_id: reparacion.empresa_id,
    cliente: { id: reparacion.cliente_id, nombre: reparacion.cliente, contacto: reparacion.contacto },
    contacto: reparacion.contacto,
    equipo: reparacion.equipo,
    modelo_id: reparacion.modelo_id,
    numero_serie: reparacion.numero_serie ?? '',
    accesorios: reparacion.accesorios,
    falla: reparacion.falla,
    costo_mano_obra: importe(reparacion.costo_mano_obra),
    costo_repuestos: importe(reparacion.costo_repuestos),
    tecnico_id: reparacion.tecnico_id ?? '',
    ingreso_en: reparacion.ingreso_en,
    entrega_prevista: reparacion.entrega_prevista ?? '',
  }
}

const MENSAJE_IMPORTE = 'Ingresá un importe de cero o más, con hasta dos decimales (por ejemplo 25000 o 25000,50).'

// Validación de pantalla (la base la repite: la autoridad es el servidor). `conCostos` = el usuario ve y edita
// los costos internos; sin `ver_costos` esos campos ni se muestran ni se validan.
export function validarReparacion(
  formulario: FormularioReparacion,
  { esNueva, conCostos }: { esNueva: boolean; conCostos: boolean },
): ErroresReparacion {
  const errores: ErroresReparacion = {}
  if (esNueva && formulario.empresa_id === '') errores.empresa_id = 'Elegí la tienda.'
  if (formulario.cliente === null) errores.cliente_id = 'Elegí el cliente.'
  if (formulario.modelo_id === '') {
    errores.modelo_id = 'Elegí el modelo.'
    if (formulario.equipo === '') errores.equipo = 'Elegí la consola o el equipo.'
  }
  for (const campo of ['contacto', 'numero_serie', 'accesorios', 'falla'] as const) {
    if (formulario[campo].trim().length > LARGO_MAXIMO_REPARACION[campo]) {
      errores[campo] = `Máximo ${LARGO_MAXIMO_REPARACION[campo]} caracteres.`
    }
  }
  if (conCostos) {
    for (const campo of ['costo_mano_obra', 'costo_repuestos'] as const) {
      if (parsearImporte(formulario[campo]) === null) errores[campo] = MENSAJE_IMPORTE
    }
  }
  if (formulario.ingreso_en === '') errores.ingreso_en = 'Ingresá la fecha de ingreso.'
  else if (formulario.ingreso_en > hoyEnArgentina()) errores.ingreso_en = 'El ingreso no puede ser una fecha futura.'
  if (formulario.entrega_prevista !== '' && formulario.ingreso_en !== '' && formulario.entrega_prevista < formulario.ingreso_en) {
    errores.entrega_prevista = 'La entrega prevista no puede ser anterior al ingreso.'
  }
  return errores
}

type ErrorDeBase = { code?: string; message?: string; hint?: string } | null

export const MENSAJE_ANULADA = 'Esta reparación está anulada: solo se puede consultar.'
export const MENSAJE_CONFLICTO_REPARACION =
  'Otra persona modificó esta reparación mientras la editabas. Recargá para ver sus cambios; no se guardó nada tuyo.'

// Campo al que apunta un error de validación de la base (`hint`), con el mensaje en castellano que ella arma.
export function errorDeCampo(error: unknown): { campo: CampoReparacion; mensaje: string } | null {
  const e = error as ErrorDeBase
  if (e?.code !== '22023' || !e.hint || !e.message) return null
  const campo = CAMPOS.find((candidato) => candidato === e.hint)
  return campo ? { campo, mensaje: e.message } : null
}

export function esConflictoDeEdicion(error: unknown): boolean {
  return (error as ErrorDeBase)?.code === '40001'
}

export function mensajeDeErrorReparacion(error: unknown, porDefecto: string): string {
  console.error(porDefecto, error)
  const e = error as ErrorDeBase
  if (e?.code === '42501') return 'No tenés permiso para esta acción. Puede que tu rol haya cambiado: recargá la página.'
  if (e?.code === '40001') return MENSAJE_CONFLICTO_REPARACION
  if (e?.code === '55000') return MENSAJE_ANULADA
  if (e?.code === 'P0002') return 'Esa reparación ya no existe. Volvé al listado.'
  // Los mensajes de validación de la base ya están en castellano y no nombran tablas ni columnas.
  if (e?.code === '22023' && e.message) return e.message
  return porDefecto
}

function lanzarSiHayError(error: unknown): void {
  if (error) throw error
}

export function aReparacion(dato: unknown): Reparacion {
  if (typeof dato !== 'object' || dato === null) throw new Error('La base no devolvió la reparación')
  const bruto = dato as Record<string, unknown>
  const numero = (valor: unknown) => (valor === null || valor === undefined ? null : Number(valor))
  const items = Array.isArray(bruto.items) ? (bruto.items as Record<string, unknown>[]) : []
  return {
    ...(bruto as unknown as Reparacion),
    costo_mano_obra: numero(bruto.costo_mano_obra),
    costo_repuestos: numero(bruto.costo_repuestos),
    total_mano_obra: Number(bruto.total_mano_obra ?? 0),
    total_repuestos: Number(bruto.total_repuestos ?? 0),
    total_cliente: Number(bruto.total_cliente ?? 0),
    ganancia_estimada: numero(bruto.ganancia_estimada),
    items: items.map((item) => ({
      ...(item as unknown as ItemReparacion),
      cantidad: Number(item.cantidad),
      precio_unitario: Number(item.precio_unitario),
      subtotal: Number(item.subtotal),
    })),
  }
}

export async function obtenerReparacion(id: string): Promise<Reparacion> {
  const { data, error } = await supabaseClient.rpc('obtener_reparacion', { p_id: id })
  lanzarSiHayError(error)
  return aReparacion(data)
}

export async function listarTecnicos(): Promise<Tecnico[]> {
  const { data, error } = await supabaseClient.rpc('tecnicos_de_service')
  lanzarSiHayError(error)
  return (data ?? []) as Tecnico[]
}

// Costos: sin `ver_costos` no se envían (null = sin cambio); con permiso, vacío vale cero.
function costosParaEnviar(formulario: FormularioReparacion, conCostos: boolean) {
  if (!conCostos) return { p_costo_mano_obra: null, p_costo_repuestos: null }
  return {
    p_costo_mano_obra: parsearImporte(formulario.costo_mano_obra) ?? 0,
    p_costo_repuestos: parsearImporte(formulario.costo_repuestos) ?? 0,
  }
}

function vacioANulo(texto: string): string | null {
  const limpio = texto.trim()
  return limpio === '' ? null : limpio
}

export async function crearReparacion(formulario: FormularioReparacion, conCostos: boolean): Promise<Reparacion> {
  const { data, error } = await supabaseClient.rpc('crear_reparacion', {
    p_empresa_id: formulario.empresa_id,
    p_cliente_id: formulario.cliente?.id ?? null,
    p_modelo_id: formulario.modelo_id === '' ? null : formulario.modelo_id,
    p_contacto: formulario.contacto.trim(),
    p_numero_serie: vacioANulo(formulario.numero_serie),
    p_accesorios: formulario.accesorios.trim(),
    p_falla: formulario.falla.trim(),
    ...costosParaEnviar(formulario, conCostos),
    p_tecnico_id: vacioANulo(formulario.tecnico_id),
    p_entrega_prevista: vacioANulo(formulario.entrega_prevista),
  })
  lanzarSiHayError(error)
  return aReparacion(data)
}

export async function actualizarReparacion(
  reparacion: Reparacion,
  formulario: FormularioReparacion,
  conCostos: boolean,
): Promise<Reparacion> {
  const { data, error } = await supabaseClient.rpc('actualizar_reparacion', {
    p_id: reparacion.id,
    p_actualizado_en: reparacion.updated_at,
    p_cliente_id: formulario.cliente?.id ?? null,
    p_modelo_id: formulario.modelo_id === '' ? null : formulario.modelo_id,
    p_contacto: formulario.contacto.trim(),
    p_numero_serie: vacioANulo(formulario.numero_serie),
    p_accesorios: formulario.accesorios.trim(),
    p_falla: formulario.falla.trim(),
    ...costosParaEnviar(formulario, conCostos),
    p_tecnico_id: vacioANulo(formulario.tecnico_id),
    p_ingreso_en: formulario.ingreso_en,
    p_entrega_prevista: vacioANulo(formulario.entrega_prevista),
  })
  lanzarSiHayError(error)
  return aReparacion(data)
}

// ---------------------------------------------------------------------------------------------------------
// Estado, historial, entrega y anulación (F-SVC-03)
// ---------------------------------------------------------------------------------------------------------

export type TipoEventoHistorial = 'alta' | 'estado' | 'entrega' | 'anulacion'

export type EventoHistorial = {
  id: string
  tipo: TipoEventoHistorial
  estado_anterior: string | null
  estado_nuevo: string | null
  nota: string | null
  usuario: string | null
  creado_en: string
}

export type FormularioEntrega = { entrega_real: string; entregado_por: string }
export type CampoEntrega = 'entrega_real' | 'entregado_por'
export type ErroresEntrega = Partial<Record<CampoEntrega, string>>

export const LARGO_MAXIMO_ENTREGADO_POR = 200
export const LARGO_MAXIMO_MOTIVO = 500

export function formularioEntregaVacio(): FormularioEntrega {
  return { entrega_real: hoyEnArgentina(), entregado_por: '' }
}

// Validación de pantalla del diálogo de entrega (FR-032); la base la repite. La fecha no puede ser anterior al
// ingreso ni futura, y quién entregó es obligatorio.
export function validarEntrega(formulario: FormularioEntrega, ingresoEn: string): ErroresEntrega {
  const errores: ErroresEntrega = {}
  if (formulario.entrega_real === '') errores.entrega_real = 'Ingresá la fecha de entrega.'
  else if (formulario.entrega_real < ingresoEn) errores.entrega_real = 'La entrega no puede ser anterior al ingreso.'
  else if (formulario.entrega_real > hoyEnArgentina()) errores.entrega_real = 'La entrega no puede ser una fecha futura.'
  const quien = formulario.entregado_por.trim()
  if (quien === '') errores.entregado_por = 'Indicá quién retira o recibe el equipo.'
  else if (quien.length > LARGO_MAXIMO_ENTREGADO_POR) errores.entregado_por = `Máximo ${LARGO_MAXIMO_ENTREGADO_POR} caracteres.`
  return errores
}

export function validarMotivoAnulacion(motivo: string): string | null {
  const limpio = motivo.trim()
  if (limpio === '') return 'Indicá el motivo de la anulación.'
  if (limpio.length > LARGO_MAXIMO_MOTIVO) return `Máximo ${LARGO_MAXIMO_MOTIVO} caracteres.`
  return null
}

// Campo de un diálogo al que apunta un error de validación de la base (`hint`).
export function errorDeCampoDe<C extends string>(
  error: unknown,
  campos: ReadonlyArray<C>,
): { campo: C; mensaje: string } | null {
  const e = error as ErrorDeBase
  if (e?.code !== '22023' || !e.hint || !e.message) return null
  const campo = campos.find((candidato) => candidato === e.hint)
  return campo ? { campo, mensaje: e.message } : null
}

export async function cambiarEstadoReparacion(id: string, estadoId: string): Promise<Reparacion> {
  const { data, error } = await supabaseClient.rpc('cambiar_estado_reparacion', { p_id: id, p_estado_id: estadoId })
  lanzarSiHayError(error)
  return aReparacion(data)
}

export async function registrarEntregaReparacion(
  id: string,
  estadoId: string,
  formulario: FormularioEntrega,
): Promise<Reparacion> {
  const { data, error } = await supabaseClient.rpc('registrar_entrega_reparacion', {
    p_id: id,
    p_estado_id: estadoId,
    p_entrega_real: formulario.entrega_real === '' ? null : formulario.entrega_real,
    p_entregado_por: formulario.entregado_por.trim(),
  })
  lanzarSiHayError(error)
  return aReparacion(data)
}

export async function anularReparacion(id: string, motivo: string): Promise<Reparacion> {
  const { data, error } = await supabaseClient.rpc('anular_reparacion', { p_id: id, p_motivo: motivo.trim() })
  lanzarSiHayError(error)
  return aReparacion(data)
}

// Más reciente primero (lo ordena la base).
export async function listarHistorial(id: string): Promise<EventoHistorial[]> {
  const { data, error } = await supabaseClient.rpc('historial_reparacion', { p_id: id })
  lanzarSiHayError(error)
  return (data ?? []) as EventoHistorial[]
}

type FilaUso = { id: string; cantidad: number | string }

function aMapaDeUso(filas: FilaUso[] | null): Map<string, number> {
  return new Map((filas ?? []).map((fila) => [fila.id, Number(fila.cantidad)]))
}

// Cantidad de reparaciones que usan cada modelo / estado (FR-019). Sin fila = cero.
export async function usoDeModelos(): Promise<Map<string, number>> {
  const { data, error } = await supabaseClient.rpc('uso_modelo_equipo')
  lanzarSiHayError(error)
  return aMapaDeUso((data ?? []) as FilaUso[])
}

export async function usoDeEstados(): Promise<Map<string, number>> {
  const { data, error } = await supabaseClient.rpc('uso_estado_reparacion')
  lanzarSiHayError(error)
  return aMapaDeUso((data ?? []) as FilaUso[])
}

export function textoUso(cantidad: number): string {
  return cantidad === 1 ? '1 reparación' : `${cantidad} reparaciones`
}
