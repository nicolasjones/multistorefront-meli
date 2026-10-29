// Formas de envío por empresa (F-VTA-02, MSF-225, FR-006/FR-007). El esquema, los valores permitidos
// y las RPC viven en las migraciones 20261021164200_formas_envio.sql y 20261021164300_formas_envio_rpc.sql;
// acá se espejan para validar antes de viajar (la autoridad es la base).
import { supabaseClient } from '../supabase'

export const TIPOS_FORMA_ENVIO = ['retiro_local', 'correo', 'expreso', 'moto', 'terminal'] as const
export type TipoFormaEnvio = (typeof TIPOS_FORMA_ENVIO)[number]

export const ETIQUETA_TIPO_FORMA_ENVIO: Readonly<Record<TipoFormaEnvio, string>> = {
  retiro_local: 'Retiro en local',
  correo: 'Correo',
  expreso: 'Expreso',
  moto: 'Moto',
  terminal: 'Terminal',
}

export const ESTADOS_DESPACHO_INICIAL = ['sin_armar', 'armando', 'listo_para_despachar'] as const
export type EstadoDespachoInicial = (typeof ESTADOS_DESPACHO_INICIAL)[number]

export const ETIQUETA_ESTADO_DESPACHO: Readonly<Record<EstadoDespachoInicial, string>> = {
  sin_armar: 'Sin armar',
  armando: 'Armando',
  listo_para_despachar: 'Listo para despachar',
}

export const NOMBRE_MAXIMO = 100
export const ORDEN_MAXIMO = 9999
// numeric(12,2): hasta 10 dígitos enteros.
export const COSTO_MAXIMO = 9_999_999_999.99

// Fila de dominio.formas_envio tal como la lee la pestaña. `costo_defecto` es numeric(12,2):
// PostgREST lo entrega como número; null = sin costo por defecto.
export type FormaEnvio = {
  id: string
  empresa_id: string
  nombre: string
  tipo: TipoFormaEnvio
  exige_transporte_guia: boolean
  costo_defecto: number | null
  estado_despacho_inicial: EstadoDespachoInicial
  orden: number
  activo: boolean
  updated_at: string
}

export const COLUMNAS_FORMA_ENVIO =
  'id, empresa_id, nombre, tipo, exige_transporte_guia, costo_defecto, estado_despacho_inicial, orden, activo, updated_at'

export type FormularioFormaEnvio = {
  nombre: string
  tipo: TipoFormaEnvio
  exigeTransporteGuia: boolean
  // Texto del campo: vacío = sin costo por defecto; se valida y convierte al enviar.
  costoDefecto: string
  estadoDespachoInicial: EstadoDespachoInicial
  orden: string
  activo: boolean
  // Solo en el alta: una forma independiente por empresa marcada.
  empresaIds: string[]
}

export type CampoFormaEnvio = 'nombre' | 'costoDefecto' | 'orden' | 'empresaIds'
export type ErroresFormaEnvio = Partial<Record<CampoFormaEnvio, string>>

export const MENSAJE_NOMBRE_VACIO = 'Completá el nombre'
export const MENSAJE_NOMBRE_REPETIDO = 'Ya existe una forma de envío con ese nombre en esa empresa.'
export const MENSAJE_COSTO_INVALIDO = 'El costo es un importe de 0 en adelante, con hasta 2 decimales.'
export const MENSAJE_CONFLICTO =
  'Otra persona modificó esta forma de envío mientras la editabas. Recargá para ver sus cambios; no se guardó nada tuyo.'

export function formularioVacio(empresaId: string, orden: number): FormularioFormaEnvio {
  return {
    nombre: '',
    tipo: 'expreso',
    exigeTransporteGuia: true,
    costoDefecto: '',
    estadoDespachoInicial: 'sin_armar',
    orden: String(orden),
    activo: true,
    empresaIds: [empresaId],
  }
}

export function aFormulario(forma: FormaEnvio): FormularioFormaEnvio {
  return {
    nombre: forma.nombre,
    tipo: forma.tipo,
    exigeTransporteGuia: forma.exige_transporte_guia,
    costoDefecto: forma.costo_defecto === null ? '' : String(forma.costo_defecto),
    estadoDespachoInicial: forma.estado_despacho_inicial,
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

export type CostoLeido = { valido: true; valor: number | null } | { valido: false }

// Vacío = sin costo (nulo, válido). Acepta coma o punto decimal y hasta 2 decimales; sin
// separador de miles (3.500 se leería como 3,5). Negativos y texto se rechazan.
export function leerCosto(texto: string): CostoLeido {
  const limpio = texto.trim()
  if (limpio === '') return { valido: true, valor: null }
  if (!/^\d+([.,]\d{1,2})?$/.test(limpio)) return { valido: false }
  const valor = Number(limpio.replace(',', '.'))
  return valor <= COSTO_MAXIMO ? { valido: true, valor } : { valido: false }
}

export function validarFormaEnvio(formulario: FormularioFormaEnvio, { alta }: { alta: boolean }): ErroresFormaEnvio {
  const errores: ErroresFormaEnvio = {}
  const nombre = formulario.nombre.trim()
  if (nombre === '') {
    errores.nombre = MENSAJE_NOMBRE_VACIO
  } else if (nombre.length > NOMBRE_MAXIMO) {
    errores.nombre = `Máximo ${NOMBRE_MAXIMO} caracteres.`
  }
  if (!leerCosto(formulario.costoDefecto).valido) {
    errores.costoDefecto = MENSAJE_COSTO_INVALIDO
  }
  if (ordenComoEntero(formulario.orden) === null) {
    errores.orden = `El orden es un número entero entre 0 y ${ORDEN_MAXIMO}.`
  }
  if (alta && formulario.empresaIds.length === 0) {
    errores.empresaIds = 'Elegí al menos una empresa.'
  }
  return errores
}

const formatoImporte = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Lista: «—» sin costo; con valor, el importe en pesos.
export function formatearCosto(costo: number | null): string {
  return costo === null ? '—' : `$ ${formatoImporte.format(costo)}`
}

type ErrorBase = { code?: string } | null

export function esConflicto(error: unknown): boolean {
  return (error as ErrorBase)?.code === '40001'
}

// El mensaje crudo de Postgres/PostgREST puede nombrar políticas, índices o columnas: al usuario va
// solo el texto en castellano y en consola queda solo el código.
export function mensajeDeError(error: unknown, porDefecto: string): string {
  console.error(porDefecto, (error as ErrorBase)?.code ?? 'sin código')
  const code = (error as ErrorBase)?.code
  if (code === '40001') return MENSAJE_CONFLICTO
  if (code === 'P0002') return 'La forma de envío ya no existe o no pertenece a tu organización.'
  if (code === '42501') return 'No tenés permiso para esta acción. Puede que tu rol haya cambiado: recargá la página.'
  // Único (empresa, nombre) es la única restricción 23505 de la tabla.
  if (code === '23505') return MENSAJE_NOMBRE_REPETIDO
  if (code === '22023' || code === '23514') return 'Algún dato no es válido. Revisá el formulario e intentá de nuevo.'
  return porDefecto
}

// Orden del catálogo: primero el `orden` cargado, después el nombre.
export async function listarFormasEnvio(empresaId: string): Promise<FormaEnvio[]> {
  const { data, error } = await supabaseClient
    .schema('dominio')
    .from('formas_envio')
    .select(COLUMNAS_FORMA_ENVIO)
    .eq('empresa_id', empresaId)
    .order('orden')
    .order('nombre')
    .returns<FormaEnvio[]>()
  if (error) throw error
  return data ?? []
}

function parametrosComunes(formulario: FormularioFormaEnvio) {
  const costo = leerCosto(formulario.costoDefecto)
  return {
    p_nombre: formulario.nombre.trim(),
    p_tipo: formulario.tipo,
    p_exige_transporte_guia: formulario.exigeTransporteGuia,
    p_costo_defecto: costo.valido ? costo.valor : null,
    p_estado_despacho_inicial: formulario.estadoDespachoInicial,
    p_orden: ordenComoEntero(formulario.orden),
    p_activo: formulario.activo,
  }
}

// Alta multiempresa: la base crea un ítem independiente por empresa, en una sola transacción.
export async function crearFormaEnvio(formulario: FormularioFormaEnvio): Promise<FormaEnvio[]> {
  const { data, error } = await supabaseClient.rpc('crear_forma_envio', {
    p_empresa_ids: formulario.empresaIds,
    ...parametrosComunes(formulario),
  })
  if (error) throw error
  return (data ?? []) as FormaEnvio[]
}

// `actualizadoEn` es el updated_at leído al abrir (bloqueo optimista, 40001 ante conflicto).
export async function actualizarFormaEnvio(
  formulario: FormularioFormaEnvio,
  datos: { id: string; actualizadoEn: string },
): Promise<FormaEnvio> {
  const { data, error } = await supabaseClient.rpc('actualizar_forma_envio', {
    p_id: datos.id,
    p_actualizado_en: datos.actualizadoEn,
    ...parametrosComunes(formulario),
  })
  if (error) throw error
  return data as FormaEnvio
}

export async function cambiarEstadoFormaEnvio(id: string, activo: boolean): Promise<FormaEnvio> {
  const { data, error } = await supabaseClient.rpc('cambiar_estado_forma_envio', { p_id: id, p_activo: activo })
  if (error) throw error
  return data as FormaEnvio
}
