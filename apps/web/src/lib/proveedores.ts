// Proveedores (F-PRV-01, FR-007/FR-008). El esquema, los límites y las RPC viven en las
// migraciones 20261018190000_proveedores_tabla.sql y 20261018190100_proveedores_rpc.sql;
// acá se espejan solo para validar en el formulario antes de viajar (la autoridad es la base).
import { supabaseClient } from './supabase'
import { normalizarCuit, validarCuit } from './cuit'

// Fila de dominio.proveedores tal como la lee la ficha.
export type Proveedor = {
  id: string
  organizacion_id: string
  razon_social: string
  cuit: string
  persona_contacto: string | null
  correo: string | null
  telefono: string | null
  direccion: string | null
  observaciones: string | null
  activo: boolean
  updated_at: string
}

export const COLUMNAS_PROVEEDOR =
  'id, organizacion_id, razon_social, cuit, persona_contacto, correo, telefono, direccion, observaciones, activo, updated_at'

export type FormularioProveedor = {
  razon_social: string
  cuit: string
  persona_contacto: string
  correo: string
  telefono: string
  direccion: string
  observaciones: string
}

export type CampoProveedor = keyof FormularioProveedor
export type ErroresProveedor = Partial<Record<CampoProveedor, string>>

export const FORMULARIO_PROVEEDOR_VACIO: FormularioProveedor = {
  razon_social: '', cuit: '', persona_contacto: '', correo: '', telefono: '', direccion: '', observaciones: '',
}

export const LARGO_MAXIMO: Readonly<Record<CampoProveedor, number>> = {
  razon_social: 200, cuit: 20, persona_contacto: 200, correo: 254, telefono: 50, direccion: 300, observaciones: 2000,
}

export const MENSAJE_CUIT_REPETIDO = 'Ya existe un proveedor con ese CUIT en tu organización (también si está desactivado).'
export const MENSAJE_CONFLICTO =
  'Otra persona modificó este proveedor mientras lo editabas. Recargá para ver sus cambios; no se guardó nada tuyo.'

const CORREO_VALIDO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export function validarProveedor(formulario: FormularioProveedor): ErroresProveedor {
  const errores: ErroresProveedor = {}
  if (formulario.razon_social.trim() === '') {
    errores.razon_social = 'Ingresá la razón social.'
  }
  const cuit = validarCuit(formulario.cuit)
  if (!cuit.valido) {
    errores.cuit = cuit.motivo
  }
  const correo = formulario.correo.trim()
  if (correo !== '' && !CORREO_VALIDO.test(correo)) {
    errores.correo = 'Ingresá un correo con formato válido, por ejemplo nombre@empresa.com.'
  }
  for (const campo of ['razon_social', 'persona_contacto', 'correo', 'telefono', 'direccion', 'observaciones'] as const) {
    if (!errores[campo] && formulario[campo].trim().length > LARGO_MAXIMO[campo]) {
      errores[campo] = `Máximo ${LARGO_MAXIMO[campo]} caracteres.`
    }
  }
  return errores
}

export function aFormulario(proveedor: Proveedor): FormularioProveedor {
  return {
    razon_social: proveedor.razon_social,
    cuit: proveedor.cuit,
    persona_contacto: proveedor.persona_contacto ?? '',
    correo: proveedor.correo ?? '',
    telefono: proveedor.telefono ?? '',
    direccion: proveedor.direccion ?? '',
    observaciones: proveedor.observaciones ?? '',
  }
}

const aNulo = (texto: string) => (texto.trim() === '' ? null : texto.trim())

// Parámetros de public.crear_proveedor. El CUIT viaja solo con dígitos (la base lo normaliza igual).
export type ParametrosCrearProveedor = {
  p_razon_social: string
  p_cuit: string
  p_persona_contacto: string | null
  p_correo: string | null
  p_telefono: string | null
  p_direccion: string | null
  p_observaciones: string | null
}

export function aParametrosCrear(formulario: FormularioProveedor): ParametrosCrearProveedor {
  return {
    p_razon_social: formulario.razon_social.trim(),
    p_cuit: normalizarCuit(formulario.cuit),
    p_persona_contacto: aNulo(formulario.persona_contacto),
    p_correo: aNulo(formulario.correo),
    p_telefono: aNulo(formulario.telefono),
    p_direccion: aNulo(formulario.direccion),
    p_observaciones: aNulo(formulario.observaciones),
  }
}

// `p_actualizado_en` es el updated_at leído al abrir (bloqueo optimista, 40001 ante conflicto).
export type ParametrosActualizarProveedor = ParametrosCrearProveedor & { p_id: string; p_actualizado_en: string }

export function aParametrosActualizar(
  formulario: FormularioProveedor,
  { id, actualizadoEn }: { id: string; actualizadoEn: string },
): ParametrosActualizarProveedor {
  return { p_id: id, p_actualizado_en: actualizadoEn, ...aParametrosCrear(formulario) }
}

// ¿Hay algo cargado que se perdería al cerrar?
export function hayCambios(actual: FormularioProveedor, inicial: FormularioProveedor): boolean {
  return (Object.keys(actual) as CampoProveedor[]).some((campo) => actual[campo].trim() !== inicial[campo].trim())
}

type ErrorBase = { code?: string; message?: string } | null

// El único índice único de la tabla además de la clave es el del CUIT.
export function esCuitRepetido(error: unknown): boolean {
  const e = error as ErrorBase
  return e?.code === '23505' && (e.message ?? '').includes('cuit')
}

export function esConflicto(error: unknown): boolean {
  return (error as ErrorBase)?.code === '40001'
}

// El mensaje crudo de Postgres/PostgREST puede nombrar políticas, restricciones o columnas:
// al usuario va solo el texto en castellano y el detalle queda en consola.
export function mensajeDeError(error: unknown, porDefecto: string): string {
  console.error(porDefecto, error)
  const code = (error as ErrorBase)?.code
  if (code === '40001') return MENSAJE_CONFLICTO
  if (code === 'P0002') return 'El proveedor ya no existe o no pertenece a tu organización.'
  if (code === '42501') return 'No tenés permiso para esta acción. Puede que tu rol haya cambiado: recargá la página.'
  if (esCuitRepetido(error)) return MENSAJE_CUIT_REPETIDO
  if (code === '22023' || code === '23514') return 'Algún dato no es válido. Revisá el formulario e intentá de nuevo.'
  return porDefecto
}

async function resolver(llamada: PromiseLike<{ data: unknown; error: unknown }>): Promise<Proveedor> {
  const { data, error } = await llamada
  if (error) throw error
  return data as Proveedor
}

export function crearProveedor(formulario: FormularioProveedor): Promise<Proveedor> {
  return resolver(supabaseClient.rpc('crear_proveedor', aParametrosCrear(formulario)))
}

export function actualizarProveedor(
  formulario: FormularioProveedor,
  datos: { id: string; actualizadoEn: string },
): Promise<Proveedor> {
  return resolver(supabaseClient.rpc('actualizar_proveedor', aParametrosActualizar(formulario, datos)))
}

export function cambiarEstadoProveedor(id: string, activo: boolean): Promise<Proveedor> {
  return resolver(supabaseClient.rpc('cambiar_estado_proveedor', { p_id: id, p_activo: activo }))
}
