// Cuentas de cobro (F-VTA-03, FR-012/FR-015). El esquema, los límites y las RPC viven en las migraciones
// 20261020120000_cuentas_cobro.sql … 20261020120300_cuentas_cobro_actividad.sql; acá se espejan solo para
// validar en el formulario antes de viajar (la autoridad es la base).
import { supabaseClient } from '../supabase'
import { normalizarCuit, validarCuit } from '../cuit'
import { normalizarCbu, validarCbu } from './cbu'

export const TIPOS_CUENTA = [
  { valor: 'cuenta_corriente', etiqueta: 'Cuenta corriente' },
  { valor: 'caja_ahorro', etiqueta: 'Caja de ahorro' },
  { valor: 'billetera_virtual', etiqueta: 'Billetera virtual' },
] as const

export type TipoCuenta = (typeof TIPOS_CUENTA)[number]['valor']

export const MONEDAS = ['ARS', 'USD'] as const
export type Moneda = (typeof MONEDAS)[number]

export type EstadoCuentasCobro = 'todas' | 'activas' | 'no_usar'

// Fila del listado: lo que devuelve `public.listar_cuentas_cobro`.
export type CuentaCobro = {
  id: string
  nombre: string
  titular: string | null
  banco: string | null
  cbu: string | null
  cuit: string | null
  alias: string | null
  tipo: TipoCuenta
  moneda: Moneda
  orden: number
  activa: boolean
  notas: string | null
  updated_at: string
  // Empresas donde está disponible («Disponible en»): id y nombre, ordenadas por nombre.
  empresas: Array<{ id: string; nombre: string }>
}

export type FormularioCuentaCobro = {
  nombre: string
  titular: string
  cuit: string
  banco: string
  alias: string
  cbu: string
  tipo: TipoCuenta
  moneda: Moneda
  orden: string
  activa: boolean
  notas: string
  empresaIds: string[]
}

export type CampoCuentaCobro = Exclude<keyof FormularioCuentaCobro, 'activa' | 'tipo' | 'moneda' | 'empresaIds'>
export type ErroresCuentaCobro = Partial<Record<CampoCuentaCobro, string>>

export const FORMULARIO_CUENTA_COBRO_VACIO: FormularioCuentaCobro = {
  nombre: '', titular: '', cuit: '', banco: '', alias: '', cbu: '',
  tipo: 'cuenta_corriente', moneda: 'ARS', orden: '0', activa: true, notas: '', empresaIds: [],
}

const LARGO_MAXIMO: Readonly<Record<'nombre' | 'titular' | 'banco' | 'alias' | 'notas', number>> = {
  nombre: 120, titular: 200, banco: 120, alias: 60, notas: 2000,
}

export const MENSAJE_CONFLICTO =
  'Otra persona modificó esta cuenta mientras la editabas. Recargá para ver sus cambios; no se guardó nada tuyo.'

// Tope de integer en Postgres: un orden mayor daría 22003 en la base.
const ORDEN_MAXIMO = 2147483647

export function validarCuentaCobro(formulario: FormularioCuentaCobro): ErroresCuentaCobro {
  const errores: ErroresCuentaCobro = {}
  if (formulario.nombre.trim() === '') errores.nombre = 'Ingresá el nombre de la cuenta.'
  if (formulario.titular.trim() === '') errores.titular = 'Ingresá el titular.'
  const cuit = validarCuit(formulario.cuit)
  if (!cuit.valido) errores.cuit = cuit.motivo
  const cbu = validarCbu(formulario.cbu)
  if (!cbu.valido) errores.cbu = cbu.motivo
  const orden = formulario.orden.trim()
  if (!/^\d+$/.test(orden)) errores.orden = 'Ingresá un número entero, 0 o mayor.'
  else if (Number(orden) > ORDEN_MAXIMO) errores.orden = `El orden no puede superar ${ORDEN_MAXIMO}.`
  for (const campo of ['nombre', 'titular', 'banco', 'alias', 'notas'] as const) {
    if (!errores[campo] && formulario[campo].trim().length > LARGO_MAXIMO[campo]) {
      errores[campo] = `Máximo ${LARGO_MAXIMO[campo]} caracteres.`
    }
  }
  return errores
}

export function aFormulario(cuenta: CuentaCobro): FormularioCuentaCobro {
  return {
    nombre: cuenta.nombre,
    titular: cuenta.titular ?? '',
    cuit: cuenta.cuit ?? '',
    banco: cuenta.banco ?? '',
    alias: cuenta.alias ?? '',
    cbu: cuenta.cbu ?? '',
    tipo: cuenta.tipo,
    moneda: cuenta.moneda,
    orden: String(cuenta.orden),
    activa: cuenta.activa,
    notas: cuenta.notas ?? '',
    empresaIds: cuenta.empresas.map((empresa) => empresa.id),
  }
}

const aNulo = (texto: string) => (texto.trim() === '' ? null : texto.trim())

// Parámetros de public.crear_cuenta_cobro. CUIT y CBU viajan solo con dígitos (la base los normaliza igual).
export type ParametrosCrearCuentaCobro = {
  p_nombre: string
  p_titular: string
  p_cuit: string
  p_banco: string | null
  p_alias: string | null
  p_cbu: string
  p_tipo: TipoCuenta
  p_moneda: Moneda
  p_orden: number
  p_activa: boolean
  p_notas: string | null
  p_empresa_ids: string[]
}

export function aParametrosCrear(formulario: FormularioCuentaCobro): ParametrosCrearCuentaCobro {
  return {
    p_nombre: formulario.nombre.trim(),
    p_titular: formulario.titular.trim(),
    p_cuit: normalizarCuit(formulario.cuit),
    p_banco: aNulo(formulario.banco),
    p_alias: aNulo(formulario.alias),
    p_cbu: normalizarCbu(formulario.cbu),
    p_tipo: formulario.tipo,
    p_moneda: formulario.moneda,
    p_orden: Number(formulario.orden.trim()),
    p_activa: formulario.activa,
    p_notas: aNulo(formulario.notas),
    p_empresa_ids: formulario.empresaIds,
  }
}

// `p_actualizado_en` es el updated_at leído al abrir (bloqueo optimista, 40001 ante conflicto).
export type ParametrosActualizarCuentaCobro = ParametrosCrearCuentaCobro & { p_id: string; p_actualizado_en: string }

export function aParametrosActualizar(
  formulario: FormularioCuentaCobro,
  { id, actualizadoEn }: { id: string; actualizadoEn: string },
): ParametrosActualizarCuentaCobro {
  return { p_id: id, p_actualizado_en: actualizadoEn, ...aParametrosCrear(formulario) }
}

type ErrorBase = { code?: string; message?: string } | null

export function esConflicto(error: unknown): boolean {
  return (error as ErrorBase)?.code === '40001'
}

// El mensaje crudo de Postgres/PostgREST puede nombrar políticas, restricciones o columnas:
// al usuario va solo el texto en castellano y el detalle queda en consola.
export function mensajeDeError(error: unknown, porDefecto: string): string {
  console.error(porDefecto, error)
  const code = (error as ErrorBase)?.code
  if (code === '40001') return MENSAJE_CONFLICTO
  if (code === 'P0002') return 'La cuenta de cobro ya no existe o no pertenece a tu organización.'
  if (code === '42501') return 'Solo un Administrador puede hacer esta acción. Puede que tu rol haya cambiado: recargá la página.'
  if (code === '22023' || code === '23514') return 'Algún dato no es válido. Revisá el formulario e intentá de nuevo.'
  return porDefecto
}

async function resolver(llamada: PromiseLike<{ error: unknown }>): Promise<void> {
  const { error } = await llamada
  if (error) throw error
}

export function crearCuentaCobro(formulario: FormularioCuentaCobro): Promise<void> {
  return resolver(supabaseClient.rpc('crear_cuenta_cobro', aParametrosCrear(formulario)))
}

export function actualizarCuentaCobro(
  formulario: FormularioCuentaCobro,
  datos: { id: string; actualizadoEn: string },
): Promise<void> {
  return resolver(supabaseClient.rpc('actualizar_cuenta_cobro', aParametrosActualizar(formulario, datos)))
}

// «No usar» (activa = false) o reactivar: idempotente, conserva los datos y el historial.
export function cambiarEstadoCuentaCobro(id: string, activa: boolean): Promise<void> {
  return resolver(supabaseClient.rpc('cambiar_estado_cuenta_cobro', { p_id: id, p_activa: activa }))
}
