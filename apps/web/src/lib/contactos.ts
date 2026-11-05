// Libreta de contactos (F-CON-05, MSF-260, épica MSF-144). La tabla `dominio.contactos` y las RPC viven
// en las migraciones 20270201100000…100500; acá se espejan los tipos y se traducen los errores. La
// autoridad es la base: RLS decide qué contactos se ven y las RPC validan permisos, duplicados y consentimiento.
import { supabaseClient } from './supabase'

export const TAMANO_PAGINA_CONTACTOS = 25
export const TEXTO_SIN_PERMISO_EDICION = 'Necesitás permiso de edición'

// Fila de `public.buscar_contactos`.
export type Contacto = {
  id: string
  empresa_id: string
  empresa_nombre: string
  nombre: string
  correo: string | null
  telefono: string | null
  anonimizado: boolean
  updated_at: string
}

// Ficha completa (`dominio.contactos`, select por RLS).
export type FichaContacto = Omit<Contacto, 'empresa_nombre' | 'anonimizado'> & {
  consentimiento_en: string
  consentimiento_texto: string
  anonimizado_en: string | null
}

export type EntradaHistorial = {
  tipo: 'consulta' | 'compra'
  referencia_id: string
  fecha: string
  empresa_id: string
  empresa_nombre: string
  resumen: string
  estado: string
  total: number | null
}

export type FiltrosContactos = {
  /** Empresa activa de la barra superior; null = todas las accesibles. */
  empresaId: string | null
  texto: string
  pagina: number
  tamano: number
}

export class ErrorContacto extends Error {
  readonly codigo: string | null
  /** `DETAIL` de la base: en un duplicado (`23505`) es el id del contacto existente. */
  readonly detalle: string | null
  constructor(mensaje: string, codigo: string | null, detalle: string | null = null) {
    super(mensaje)
    this.name = 'ErrorContacto'
    this.codigo = codigo
    this.detalle = detalle
  }
}

type ErrorPostgrest = { message?: string; code?: string; details?: string | null }

function aError(error: ErrorPostgrest): ErrorContacto {
  return new ErrorContacto(error.message ?? 'Error desconocido', error.code ?? null, error.details ?? null)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function esConflicto(error: unknown): boolean {
  return error instanceof ErrorContacto && error.codigo === '40001'
}

/** Id del contacto existente cuando el alta o la edición chocó con un duplicado. */
export function contactoExistenteDe(error: unknown): string | null {
  if (error instanceof ErrorContacto && error.codigo === '23505' && error.detalle && UUID.test(error.detalle)) {
    return error.detalle
  }
  return null
}

// Mensaje para la persona: nunca el texto crudo de la base (puede traer detalles técnicos).
export function mensajeDeError(error: unknown, porDefecto: string): string {
  if (error instanceof ErrorContacto) {
    if (error.codigo === '40001') return 'Otra persona modificó este contacto mientras lo editabas. Recargalo para ver sus cambios.'
    if (error.codigo === '42501') return 'No tenés permiso para cambiar este contacto.'
    if (error.codigo === '23505') return 'Ya existe un contacto con ese correo o teléfono en esta empresa.'
    if (error.codigo === '22023') {
      switch (error.detalle) {
        case 'nombre': return 'Escribí el nombre (hasta 120 caracteres).'
        case 'contacto': return 'Indicá al menos un correo o un teléfono.'
        case 'correo': return 'El correo no es válido.'
        case 'telefono': return 'El teléfono no es válido: usá entre 7 y 15 dígitos.'
        case 'consentimiento': return 'Confirmá el consentimiento para guardar el contacto.'
        case 'anonimizado': return 'El contacto está anonimizado y ya no se puede usar.'
        default: return 'Revisá los datos: algo no es válido.'
      }
    }
  }
  return porDefecto
}

// Valores de la consulta → campos del formulario: el contacto de la consulta va a `correo` si lo parece
// y a `teléfono` en otro caso (la misma regla que valida la alta pública de consultas).
export function repartirContacto(contacto: string): { correo: string; telefono: string } {
  const valor = contacto.trim()
  return valor.includes('@') ? { correo: valor, telefono: '' } : { correo: '', telefono: valor }
}

// Cuántos dígitos tiene un teléfono (la base exige de 7 a 15).
export function digitos(valor: string): number {
  return valor.replace(/\D/g, '').length
}

type FilaBusqueda = Contacto & { total: number | string }

export async function listarContactos(filtros: FiltrosContactos): Promise<{ filas: Contacto[]; total: number }> {
  const { data, error } = await supabaseClient.rpc('buscar_contactos', {
    p_empresa_id: filtros.empresaId,
    p_busqueda: filtros.texto.trim() === '' ? null : filtros.texto.trim(),
    p_limite: filtros.tamano,
    p_desde: (filtros.pagina - 1) * filtros.tamano,
  })
  if (error) throw aError(error)
  const filas = (data ?? []) as FilaBusqueda[]
  return {
    filas: filas.map(({ total: _total, ...fila }) => fila),
    total: filas.length > 0 ? Number(filas[0].total) : 0,
  }
}

const COLUMNAS_FICHA =
  'id, empresa_id, nombre, correo, telefono, consentimiento_en, consentimiento_texto, anonimizado_en, updated_at'

// null si no existe o la RLS no lo deja ver: la pantalla no distingue los dos casos.
export async function leerContacto(id: string): Promise<FichaContacto | null> {
  const { data, error } = await supabaseClient
    .schema('dominio')
    .from('contactos')
    .select(COLUMNAS_FICHA)
    .eq('id', id)
    .maybeSingle()
  if (error) throw aError(error)
  return (data as FichaContacto | null) ?? null
}

export async function leerHistorial(contactoId: string): Promise<EntradaHistorial[]> {
  const { data, error } = await supabaseClient.rpc('historial_contacto', { p_contacto_id: contactoId })
  if (error) throw aError(error)
  return ((data ?? []) as Array<EntradaHistorial & { total: number | string | null }>).map((fila) => ({
    ...fila,
    total: fila.total === null ? null : Number(fila.total),
  }))
}

export type DatosContacto = { nombre: string; correo: string; telefono: string }

const nulo = (valor: string): string | null => (valor.trim() === '' ? null : valor.trim())

export async function crearContacto(datos: DatosContacto & {
  empresaId: string
  consentimiento: boolean
  consentimientoTexto: string
  consultaId?: string | null
}): Promise<string> {
  const { data, error } = await supabaseClient.rpc('crear_contacto', {
    p_empresa_id: datos.empresaId,
    p_nombre: datos.nombre,
    p_correo: nulo(datos.correo),
    p_telefono: nulo(datos.telefono),
    p_consentimiento: datos.consentimiento,
    p_consentimiento_texto: datos.consentimientoTexto,
    p_consulta_id: datos.consultaId ?? null,
  })
  if (error) throw aError(error)
  return data as string
}

export async function actualizarContacto(datos: DatosContacto & { id: string; actualizadoEn: string }): Promise<string> {
  const { data, error } = await supabaseClient.rpc('actualizar_contacto', {
    p_id: datos.id,
    p_nombre: datos.nombre,
    p_correo: nulo(datos.correo),
    p_telefono: nulo(datos.telefono),
    p_updated_at: datos.actualizadoEn,
  })
  if (error) throw aError(error)
  return data as string
}

export async function vincularConsulta(consultaId: string, contactoId: string): Promise<void> {
  const { error } = await supabaseClient.rpc('vincular_consulta_contacto', {
    p_consulta_id: consultaId,
    p_contacto_id: contactoId,
  })
  if (error) throw aError(error)
}

/** `contactoId = null` desvincula el comprobante. */
export async function vincularComprobante(comprobanteId: string, contactoId: string | null): Promise<void> {
  const { error } = await supabaseClient.rpc('vincular_comprobante_contacto', {
    p_comprobante_id: comprobanteId,
    p_contacto_id: contactoId,
  })
  if (error) throw aError(error)
}

export async function anonimizarContacto(id: string, actualizadoEn: string): Promise<void> {
  const { error } = await supabaseClient.rpc('anonimizar_contacto', { p_id: id, p_updated_at: actualizadoEn })
  if (error) throw aError(error)
}
