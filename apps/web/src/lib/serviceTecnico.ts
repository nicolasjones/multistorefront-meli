// Service técnico · catálogos (F-SVC-01, FR-004…FR-008). El esquema, los límites y las RPC viven en las
// migraciones 20261020100100…20261020100500; acá se espejan solo para validar el formulario antes de viajar
// (la autoridad es la base) y para traducir los errores a mensajes claros.
import { supabaseClient } from './supabase'

export type ModeloEquipo = {
  id: string
  equipo: string
  modelo: string
  mano_obra_base: number
  activo: boolean
  updated_at: string
}

export type TonoEstado = 'neutral' | 'primario' | 'exito' | 'aviso' | 'error' | 'info'

export type EstadoReparacion = {
  id: string
  nombre: string
  descripcion: string
  orden: number
  avisa_cliente: boolean
  cierra: boolean
  tono: TonoEstado
  activo: boolean
  updated_at: string
}

const COLUMNAS_MODELO = 'id, equipo, modelo, mano_obra_base, activo, updated_at'
const COLUMNAS_ESTADO = 'id, nombre, descripcion, orden, avisa_cliente, cierra, tono, activo, updated_at'

export const LARGO_MAXIMO_EQUIPO = 100
export const LARGO_MAXIMO_MODELO = 100
export const LARGO_MAXIMO_NOMBRE_ESTADO = 80
export const LARGO_MAXIMO_DESCRIPCION_ESTADO = 500
// numeric(12, 2): hasta 10 enteros y 2 decimales.
export const MAXIMO_MANO_OBRA = 9_999_999_999.99

export type FormularioModelo = { equipo: string; modelo: string; mano_obra_base: string }
export type ErroresModelo = Partial<Record<keyof FormularioModelo, string>>
export const FORMULARIO_MODELO_VACIO: FormularioModelo = { equipo: '', modelo: '', mano_obra_base: '' }

export type FormularioEstado = { nombre: string; descripcion: string; avisa_cliente: boolean }
export type ErroresEstado = Partial<Record<'nombre' | 'descripcion', string>>
export const FORMULARIO_ESTADO_VACIO: FormularioEstado = { nombre: '', descripcion: '', avisa_cliente: false }

// Importe en pesos tal como lo tipea la persona, sin separador de miles: admite coma o punto decimal
// («25000», «25000,50»). Vacío equivale a 0; algo que no sea un importe válido devuelve null.
export function parsearImporte(texto: string): number | null {
  const limpio = texto.trim().replace(',', '.')
  if (limpio === '') return 0
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return null
  const valor = Number(limpio)
  return valor <= MAXIMO_MANO_OBRA ? valor : null
}

export function validarModelo(formulario: FormularioModelo): ErroresModelo {
  const errores: ErroresModelo = {}
  const equipo = formulario.equipo.trim()
  const modelo = formulario.modelo.trim()
  if (equipo === '') errores.equipo = 'Ingresá el equipo.'
  else if (equipo.length > LARGO_MAXIMO_EQUIPO) errores.equipo = `Máximo ${LARGO_MAXIMO_EQUIPO} caracteres.`
  if (modelo === '') errores.modelo = 'Ingresá el modelo.'
  else if (modelo.length > LARGO_MAXIMO_MODELO) errores.modelo = `Máximo ${LARGO_MAXIMO_MODELO} caracteres.`
  if (parsearImporte(formulario.mano_obra_base) === null) {
    errores.mano_obra_base = 'Ingresá un importe de cero o más, con hasta dos decimales (por ejemplo 25000 o 25000,50).'
  }
  return errores
}

export function validarEstado(formulario: FormularioEstado): ErroresEstado {
  const errores: ErroresEstado = {}
  const nombre = formulario.nombre.trim()
  if (nombre === '') errores.nombre = 'Ingresá el nombre del estado.'
  else if (nombre.length > LARGO_MAXIMO_NOMBRE_ESTADO) errores.nombre = `Máximo ${LARGO_MAXIMO_NOMBRE_ESTADO} caracteres.`
  if (formulario.descripcion.trim().length > LARGO_MAXIMO_DESCRIPCION_ESTADO) {
    errores.descripcion = `Máximo ${LARGO_MAXIMO_DESCRIPCION_ESTADO} caracteres.`
  }
  return errores
}

type ErrorDeBase = { code?: string; message?: string; constraint?: string } | null

// Nombres de los índices únicos (migraciones 20261020100100 y 20261020100200): el mensaje de Postgres
// menciona el índice, así se distingue qué se repitió.
export function esModeloRepetido(error: unknown): boolean {
  const e = error as ErrorDeBase
  return e?.code === '23505' && `${e.message ?? ''} ${e.constraint ?? ''}`.includes('modelos_equipo_org_equipo_modelo_key')
}

export function esEstadoRepetido(error: unknown): boolean {
  const e = error as ErrorDeBase
  return e?.code === '23505' && `${e.message ?? ''} ${e.constraint ?? ''}`.includes('estados_reparacion_org_nombre_key')
}

export const MENSAJE_MODELO_REPETIDO = 'Ya existe ese modelo para ese equipo (también si está desactivado).'
export const MENSAJE_ESTADO_REPETIDO = 'Ya existe un estado con ese nombre (también si está desactivado).'
export const MENSAJE_CONFLICTO =
  'Otra persona modificó este registro mientras lo editabas. Recargá para ver sus cambios; no se guardó nada tuyo.'

// El mensaje crudo de Postgres/PostgREST puede nombrar políticas o columnas: al usuario va solo el texto en
// castellano y el detalle queda en consola.
export function mensajeDeErrorService(error: unknown, porDefecto: string): string {
  console.error(porDefecto, error)
  const code = (error as ErrorDeBase)?.code
  if (code === '42501') return 'No tenés permiso para esta acción. Puede que tu rol haya cambiado: recargá la página.'
  if (code === '40001') return MENSAJE_CONFLICTO
  if (code === '22023') return 'Algún dato no es válido. Revisá el formulario e intentá de nuevo.'
  if (code === 'P0002') return 'Ese registro ya no existe. Recargá la página.'
  if (esModeloRepetido(error)) return MENSAJE_MODELO_REPETIDO
  if (esEstadoRepetido(error)) return MENSAJE_ESTADO_REPETIDO
  if (code === '23505') return 'Ya existe un registro igual.'
  return porDefecto
}

function lanzarSiHayError(error: unknown): void {
  if (error) throw error
}

export async function listarModelos(): Promise<ModeloEquipo[]> {
  const { data, error } = await supabaseClient
    .schema('dominio')
    .from('modelos_equipo')
    .select(COLUMNAS_MODELO)
    .order('equipo', { ascending: true })
    .order('modelo', { ascending: true })
    .returns<ModeloEquipo[]>()
  lanzarSiHayError(error)
  // numeric llega como número o texto según el transporte: se normaliza.
  return (data ?? []).map((modelo) => ({ ...modelo, mano_obra_base: Number(modelo.mano_obra_base) }))
}

export async function listarEstados(): Promise<EstadoReparacion[]> {
  const { data, error } = await supabaseClient
    .schema('dominio')
    .from('estados_reparacion')
    .select(COLUMNAS_ESTADO)
    .order('orden', { ascending: true })
    .returns<EstadoReparacion[]>()
  lanzarSiHayError(error)
  return data ?? []
}

export async function crearModelo(formulario: FormularioModelo): Promise<void> {
  const { error } = await supabaseClient.rpc('crear_modelo_equipo', {
    p_equipo: formulario.equipo.trim(),
    p_modelo: formulario.modelo.trim(),
    p_mano_obra_base: parsearImporte(formulario.mano_obra_base) ?? 0,
  })
  lanzarSiHayError(error)
}

export async function cambiarActivoModelo(id: string, activo: boolean): Promise<void> {
  const { error } = await supabaseClient.rpc('cambiar_estado_modelo_equipo', { p_id: id, p_activo: activo })
  lanzarSiHayError(error)
}

export async function crearEstado(formulario: FormularioEstado): Promise<void> {
  const { error } = await supabaseClient.rpc('crear_estado_reparacion', {
    p_nombre: formulario.nombre.trim(),
    p_descripcion: formulario.descripcion.trim(),
    p_avisa_cliente: formulario.avisa_cliente,
  })
  lanzarSiHayError(error)
}

// Solo cambia «Avisa al cliente»: el nombre y la descripción viajan tal cual están (bloqueo optimista por updated_at).
export async function cambiarAvisaCliente(estado: EstadoReparacion, avisaCliente: boolean): Promise<void> {
  const { error } = await supabaseClient.rpc('actualizar_estado_reparacion', {
    p_id: estado.id,
    p_actualizado_en: estado.updated_at,
    p_nombre: estado.nombre,
    p_descripcion: estado.descripcion,
    p_avisa_cliente: avisaCliente,
  })
  lanzarSiHayError(error)
}

export async function moverEstado(id: string, direccion: 'subir' | 'bajar'): Promise<void> {
  const { error } = await supabaseClient.rpc('mover_estado_reparacion', { p_id: id, p_direccion: direccion })
  lanzarSiHayError(error)
}

export async function cambiarActivoEstado(id: string, activo: boolean): Promise<void> {
  const { error } = await supabaseClient.rpc('cambiar_estado_estado_reparacion', { p_id: id, p_activo: activo })
  lanzarSiHayError(error)
}

const FORMATO_ARS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 })

export function formatearARS(importe: number): string {
  return FORMATO_ARS.format(importe)
}
