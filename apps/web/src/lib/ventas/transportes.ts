// Transportes y terminales de retiro (F-VTA-04, FR-017/FR-018/FR-019). El esquema, los límites y las
// RPC viven en las migraciones 20261020130000_transportes.sql y 20261020130100_transportes_rpc.sql;
// acá se espejan solo para validar en el formulario antes de viajar (la autoridad es la base).
import { supabaseClient } from '../supabase'
import { normalizarCuit, validarCuit } from '../cuit'

export type TipoTransporte = 'expreso' | 'correo' | 'moto_propia'

export const TIPOS_TRANSPORTE: ReadonlyArray<{ valor: TipoTransporte; etiqueta: string }> = [
  { valor: 'expreso', etiqueta: 'Expreso' },
  { valor: 'correo', etiqueta: 'Correo' },
  { valor: 'moto_propia', etiqueta: 'Moto propia' },
]

export function etiquetaTipo(tipo: TipoTransporte): string {
  return TIPOS_TRANSPORTE.find((t) => t.valor === tipo)?.etiqueta ?? tipo
}

// Fila que devuelve `public.listar_transportes` (sin los totales).
export type Transporte = {
  id: string
  organizacion_id: string
  nombre: string
  tipo: TipoTransporte
  cuit: string | null
  terminal_retiro: string | null
  localidad: string | null
  telefono: string | null
  correo: string | null
  persona_contacto: string | null
  direccion: string | null
  cobra_contrarreembolso: boolean
  comision_pct: number
  plazo_rendicion_dias: number
  orden: number
  activa: boolean
  updated_at: string
  // «Empresas donde se usa»: id y nombre, ordenadas por nombre.
  empresas: Array<{ id: string; nombre: string }>
}

type FilaListado = Transporte & { total_filas: number | string; total_organizacion: number | string }

export type PaginaTransportes = {
  transportes: Transporte[]
  // N: transportes que cumplen el filtro por tienda; M: todos los de la organización.
  total: number
  totalOrganizacion: number
}

export type FormularioTransporte = {
  nombre: string
  tipo: TipoTransporte
  cuit: string
  terminal_retiro: string
  localidad: string
  telefono: string
  correo: string
  persona_contacto: string
  direccion: string
  cobra_contrarreembolso: boolean
  // Texto: admite coma decimal («2,5»).
  comision: string
  plazo_rendicion_dias: string
  orden: string
  activa: boolean
  empresaIds: string[]
}

export type CampoTransporte = keyof FormularioTransporte
export type ErroresTransporte = Partial<Record<CampoTransporte, string>>

export const FORMULARIO_TRANSPORTE_VACIO: FormularioTransporte = {
  nombre: '', tipo: 'expreso', cuit: '', terminal_retiro: '', localidad: '', telefono: '', correo: '',
  persona_contacto: '', direccion: '', cobra_contrarreembolso: false, comision: '', plazo_rendicion_dias: '',
  orden: '', activa: true, empresaIds: [],
}

// Mismos límites que los CHECK de dominio.transportes (migración 20261020130000): mantener alineados.
export const LARGO_MAXIMO = {
  nombre: 200, cuit: 20, terminal_retiro: 300, localidad: 200, telefono: 50, correo: 254, persona_contacto: 200, direccion: 300,
} as const
export const PLAZO_MAXIMO_DIAS = 3650
export const ORDEN_MAXIMO = 100000

export const MENSAJE_NOMBRE_REPETIDO = 'Ya existe una empresa de transporte con ese nombre en tu organización (también si está desactivada).'
export const MENSAJE_CONFLICTO =
  'Otra persona modificó esta empresa mientras la editabas. Recargá para ver sus cambios; no se guardó nada tuyo.'

// Misma regla que el disparador de dominio.transportes: mantener alineadas.
const CORREO_VALIDO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// «2,5» y «2.5» son lo mismo; vacío = 0. NaN si no es un número.
export function parsearNumero(texto: string): number {
  const limpio = texto.trim().replace(',', '.')
  if (limpio === '') return 0
  return /^-?\d+(\.\d+)?$/.test(limpio) ? Number(limpio) : Number.NaN
}

export function validarTransporte(formulario: FormularioTransporte): ErroresTransporte {
  const errores: ErroresTransporte = {}
  if (formulario.nombre.trim() === '') {
    errores.nombre = 'Ingresá el nombre de la empresa de transporte.'
  }
  // El CUIT es opcional (la moto propia no tiene), pero si se carga debe ser válido.
  if (formulario.cuit.trim() !== '') {
    const cuit = validarCuit(formulario.cuit)
    if (!cuit.valido) errores.cuit = cuit.motivo
  }
  const correo = formulario.correo.trim()
  if (correo !== '' && !CORREO_VALIDO.test(correo)) {
    errores.correo = 'Ingresá un correo con formato válido, por ejemplo nombre@empresa.com.'
  }
  const comision = parsearNumero(formulario.comision)
  if (Number.isNaN(comision)) {
    errores.comision = 'Ingresá la comisión como número, por ejemplo 2,5.'
  } else if (comision < 0 || comision > 100) {
    errores.comision = 'La comisión debe estar entre 0 y 100.'
  } else if (!/^\d+([.,]\d{0,2})?$/.test(formulario.comision.trim() || '0')) {
    errores.comision = 'La comisión admite hasta dos decimales.'
  }
  const plazo = parsearNumero(formulario.plazo_rendicion_dias)
  if (Number.isNaN(plazo) || !Number.isInteger(plazo)) {
    errores.plazo_rendicion_dias = 'Ingresá los días como un número entero.'
  } else if (plazo < 0 || plazo > PLAZO_MAXIMO_DIAS) {
    errores.plazo_rendicion_dias = `El plazo debe estar entre 0 y ${PLAZO_MAXIMO_DIAS} días.`
  }
  const orden = parsearNumero(formulario.orden)
  if (Number.isNaN(orden) || !Number.isInteger(orden)) {
    errores.orden = 'Ingresá el orden como un número entero.'
  } else if (orden < 0 || orden > ORDEN_MAXIMO) {
    errores.orden = `El orden debe estar entre 0 y ${ORDEN_MAXIMO}.`
  }
  for (const campo of ['nombre', 'terminal_retiro', 'localidad', 'telefono', 'correo', 'persona_contacto', 'direccion'] as const) {
    if (!errores[campo] && formulario[campo].trim().length > LARGO_MAXIMO[campo]) {
      errores[campo] = `Máximo ${LARGO_MAXIMO[campo]} caracteres.`
    }
  }
  return errores
}

export function aFormulario(transporte: Transporte): FormularioTransporte {
  return {
    nombre: transporte.nombre,
    tipo: transporte.tipo,
    cuit: transporte.cuit ?? '',
    terminal_retiro: transporte.terminal_retiro ?? '',
    localidad: transporte.localidad ?? '',
    telefono: transporte.telefono ?? '',
    correo: transporte.correo ?? '',
    persona_contacto: transporte.persona_contacto ?? '',
    direccion: transporte.direccion ?? '',
    cobra_contrarreembolso: transporte.cobra_contrarreembolso,
    comision: String(transporte.comision_pct).replace('.', ','),
    plazo_rendicion_dias: String(transporte.plazo_rendicion_dias),
    orden: String(transporte.orden),
    activa: transporte.activa,
    empresaIds: transporte.empresas.map((empresa) => empresa.id),
  }
}

const aNulo = (texto: string) => (texto.trim() === '' ? null : texto.trim())

// Parámetros de public.crear_transporte. El CUIT viaja solo con dígitos (la base lo normaliza igual).
export type ParametrosCrearTransporte = {
  p_nombre: string
  p_tipo: TipoTransporte
  p_cuit: string | null
  p_terminal_retiro: string | null
  p_localidad: string | null
  p_telefono: string | null
  p_correo: string | null
  p_persona_contacto: string | null
  p_direccion: string | null
  p_cobra_contrarreembolso: boolean
  p_comision_pct: number
  p_plazo_rendicion_dias: number
  p_orden: number
  p_activa: boolean
  p_empresa_ids: string[]
}

export function aParametrosCrear(formulario: FormularioTransporte): ParametrosCrearTransporte {
  return {
    p_nombre: formulario.nombre.trim(),
    p_tipo: formulario.tipo,
    p_cuit: formulario.cuit.trim() === '' ? null : normalizarCuit(formulario.cuit),
    p_terminal_retiro: aNulo(formulario.terminal_retiro),
    p_localidad: aNulo(formulario.localidad),
    p_telefono: aNulo(formulario.telefono),
    p_correo: aNulo(formulario.correo),
    p_persona_contacto: aNulo(formulario.persona_contacto),
    p_direccion: aNulo(formulario.direccion),
    p_cobra_contrarreembolso: formulario.cobra_contrarreembolso,
    p_comision_pct: parsearNumero(formulario.comision),
    p_plazo_rendicion_dias: parsearNumero(formulario.plazo_rendicion_dias),
    p_orden: parsearNumero(formulario.orden),
    p_activa: formulario.activa,
    p_empresa_ids: formulario.empresaIds,
  }
}

// `p_actualizado_en` es el updated_at leído al abrir (bloqueo optimista, 40001 ante conflicto).
export type ParametrosActualizarTransporte = ParametrosCrearTransporte & { p_id: string; p_actualizado_en: string }

export function aParametrosActualizar(
  formulario: FormularioTransporte,
  { id, actualizadoEn }: { id: string; actualizadoEn: string },
): ParametrosActualizarTransporte {
  return { p_id: id, p_actualizado_en: actualizadoEn, ...aParametrosCrear(formulario) }
}

type ErrorBase = { code?: string; message?: string; details?: string } | null

// Índice único (organizacion_id, lower(btrim(nombre))) de dominio.transportes: si se renombra en
// la migración 20261020130000, actualizar acá también.
const RESTRICCION_NOMBRE = 'transportes_organizacion_nombre_uq'

export function esNombreRepetido(error: unknown): boolean {
  const e = error as ErrorBase
  if (e?.code !== '23505') return false
  return (e.message ?? '').includes(RESTRICCION_NOMBRE) || (e.details ?? '').includes('(organizacion_id')
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
  if (code === 'P0002') return 'La empresa de transporte ya no existe o no pertenece a tu organización.'
  if (code === '42501') return 'No tenés permiso para esta acción. Solo un Administrador puede editar transportes: recargá la página.'
  if (esNombreRepetido(error)) return MENSAJE_NOMBRE_REPETIDO
  if (code === '22023' || code === '23514') return 'Algún dato no es válido. Revisá el formulario e intentá de nuevo.'
  return porDefecto
}

async function resolver(llamada: PromiseLike<{ data: unknown; error: unknown }>): Promise<Transporte> {
  const { data, error } = await llamada
  if (error) throw error
  return data as Transporte
}

export function crearTransporte(formulario: FormularioTransporte): Promise<Transporte> {
  return resolver(supabaseClient.rpc('crear_transporte', aParametrosCrear(formulario)))
}

export function actualizarTransporte(
  formulario: FormularioTransporte,
  datos: { id: string; actualizadoEn: string },
): Promise<Transporte> {
  return resolver(supabaseClient.rpc('actualizar_transporte', aParametrosActualizar(formulario, datos)))
}

export function cambiarEstadoTransporte(id: string, activa: boolean): Promise<Transporte> {
  return resolver(supabaseClient.rpc('cambiar_estado_transporte', { p_id: id, p_activa: activa }))
}

// Listado paginado por tienda (`public.listar_transportes`, RLS del llamador): el navegador nunca
// descarga la lista completa. Rechaza con el error del servidor.
export async function listarTransportes(
  { empresaId, pagina, tamano }: { empresaId: string | null; pagina: number; tamano: number },
): Promise<PaginaTransportes> {
  const { data, error } = await supabaseClient.rpc('listar_transportes', {
    p_empresa_id: empresaId,
    p_pagina: pagina,
    p_tamano: tamano,
  })
  if (error) throw error
  const filas = (data ?? []) as FilaListado[]
  return {
    transportes: filas.map(({ total_filas: _n, total_organizacion: _m, ...transporte }) => ({
      ...transporte,
      comision_pct: Number(transporte.comision_pct),
    })),
    total: filas.length > 0 ? Number(filas[0].total_filas) : 0,
    totalOrganizacion: filas.length > 0 ? Number(filas[0].total_organizacion) : 0,
  }
}
