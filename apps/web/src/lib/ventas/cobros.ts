// Cobros por comprobante (F-VTA-12, FR-007). El esquema, los límites y las RPC viven en las
// migraciones 20261215100000_cobros_comprobante.sql … 20261215100300_registrar_cobro.sql; acá se
// espejan solo para validar en el formulario antes de viajar (la autoridad es la base).
// Contrato de las RPC: specs/20261024-150000-ventas-cobros-y-conciliacion/contracts/ventas-cobros-y-conciliacion.md
import { supabaseClient } from '../supabase'
import { formatearImporteHistorial } from '../formatoHistorial'
import { etiquetaCuentaCobro } from './cuentasCobro'
import type { Comprobante } from '../ventas'

// Fila del listado: lo que devuelve `public.cobros_de_comprobante`.
export type Cobro = {
  id: string
  fecha: string
  forma_pago: string | null
  // Tipo de la forma de pago (`efectivo`, `transferencia`, `contrarreembolso`, `tarjeta`, `otro`):
  // el nombre lo edita la persona, el tipo no. La pantalla lo usa para el texto de
  // contrarreembolso (FR-008).
  forma_pago_tipo: string | null
  cuenta_cobro: string | null
  // Banco y titular de la cuenta: el detalle muestra «Banco · Titular» (FR-008).
  cuenta_cobro_banco: string | null
  cuenta_cobro_titular: string | null
  importe: number
  origen: 'manual' | 'contrarreembolso'
  conciliado: boolean
  aprobado_por: string | null
  registrado_por: string | null
}

// Fila que devuelve `public.registrar_cobro`: la del libro de cobros (`dominio.cobros_comprobante`).
export type CobroRegistrado = {
  id: string
  organizacion_id: string
  empresa_id: string
  comprobante_id: string
  importe: number
  forma_pago_id: string
  cuenta_cobro_id: string | null
  origen: 'manual' | 'contrarreembolso'
  registrado_por: string
  registrado_por_nombre: string
  registrado_en: string
  aprobado_por: string | null
  aprobado_por_nombre: string | null
  aprobado_en: string | null
  actualizado_en: string
}

// Lo que devuelve `public.saldo_comprobante`: total con IVA, lo cobrado y lo que falta.
export type SaldoComprobante = {
  total: number
  cobrado: number
  saldo: number
}

// Formulario del diálogo «Registrar cobro».
export type FormularioCobro = {
  forma_pago_id: string
  cuenta_cobro_id: string
  importe: string
}

export type CampoCobro = keyof FormularioCobro
export type ErroresCobro = Partial<Record<CampoCobro, string>>

export const FORMULARIO_COBRO_VACIO: FormularioCobro = {
  forma_pago_id: '',
  cuenta_cobro_id: '',
  importe: '',
}

// Acepta «400» o «400,50»; rechaza letras, miles y más de dos decimales (la columna es
// numeric(14,2)). Mismo criterio que `parsearImporte` de productos.
const IMPORTE_VALIDO = /^\d{1,12}([.,]\d{1,2})?$/

export function parsearImporteCobro(texto: string): number | null {
  const limpio = texto.trim()
  return IMPORTE_VALIDO.test(limpio) ? Number(limpio.replace(',', '.')) : null
}

// Validación de pantalla (la base la repite: la autoridad es el servidor). Mismo criterio que
// `private.registrar_cobro_interno`: importe mayor a cero, con dos decimales como máximo y nunca
// mayor al saldo pendiente.
export function validarCobro(
  formulario: FormularioCobro,
  { saldo, exigeCuenta }: { saldo: number; exigeCuenta: boolean },
): ErroresCobro {
  const errores: ErroresCobro = {}
  if (formulario.forma_pago_id.trim() === '') {
    errores.forma_pago_id = 'Elegí la forma de pago.'
  }
  if (exigeCuenta && formulario.cuenta_cobro_id.trim() === '') {
    errores.cuenta_cobro_id = 'La forma de pago exige una cuenta de cobro.'
  }
  const importe = parsearImporteCobro(formulario.importe)
  if (formulario.importe.trim() === '') {
    errores.importe = 'Ingresá el importe del cobro.'
  } else if (importe === null) {
    errores.importe = 'Ingresá el importe como número, con hasta dos decimales.'
  } else if (importe <= 0) {
    errores.importe = 'El importe tiene que ser mayor a cero.'
  } else if (Number.isFinite(saldo) && importe > saldo) {
    // El saldo va formateado como en el resto de la pantalla («$ 1.000»): un número crudo
    // («1000.5») se lee como miles y decimales mezclados.
    errores.importe = `El importe no puede superar el saldo pendiente (${formatearImporteHistorial(saldo)}).`
  }
  return errores
}

type ErrorDeBase = { code?: string; message?: string; hint?: string } | null

const CAMPOS: readonly CampoCobro[] = ['forma_pago_id', 'cuenta_cobro_id', 'importe']

// Códigos con los que la RPC `registrar_cobro` marca un campo con el `hint`: la validación de
// los datos (22023) y el tope contra el saldo (P0001). Los dos viajan con `hint`, así que los
// dos se leen; si el `hint` falta, el error es general y se muestra como aviso.
const CODIGOS_CON_CAMPO: readonly string[] = ['22023', 'P0001']

// El error de la base trae el `hint` con el nombre del campo: la pantalla lo marca donde está
// (importe, forma de pago o cuenta de cobro) en lugar de mostrar un error general.
export function errorDeCampoCobro(error: unknown): { campo: CampoCobro; mensaje: string } | null {
  const e = error as ErrorDeBase
  if (!e?.code || !CODIGOS_CON_CAMPO.includes(e.code) || !e.hint || !e.message) return null
  const campo = CAMPOS.find((candidato) => candidato === e.hint)
  return campo ? { campo, mensaje: e.message } : null
}

export function mensajeDeErrorCobro(error: unknown, porDefecto: string): string {
  const e = error as ErrorDeBase
  if (e?.code === '42501') {
    return 'No tenés permiso para registrar cobros en esta tienda. Puede que tu rol haya cambiado: recargá la página.'
  }
  if (e?.code === 'P0002') return 'Ese comprobante no existe o no pertenece a tu organización.'
  if (e?.code === 'P0001') return 'El importe supera el saldo pendiente de la factura.'
  if (e?.code === '55000') return 'Esta factura no admite cobros: está en borrador o anulada.'
  // Los mensajes de validación de la base ya están en castellano y no nombran tablas ni columnas.
  if (e?.code === '22023' && e.message) return e.message
  return porDefecto
}

// Parámetros de `public.registrar_cobro`. El `p_actualizado_en` viaja en null a propósito: el
// cobro no usa bloqueo optimista (la base serializa con bloqueo de fila sobre el comprobante y
// recalcula el saldo); el parámetro está en el contrato y se manda para respetarlo.
export type ParametrosRegistrarCobro = {
  p_comprobante_id: string
  p_importe: number
  p_forma_pago_id: string | null
  p_cuenta_cobro_id: string | null
  p_actualizado_en: null
}

export function aParametrosRegistrar(comprobanteId: string, formulario: FormularioCobro): ParametrosRegistrarCobro {
  const importe = parsearImporteCobro(formulario.importe)
  if (importe === null) throw new Error('El importe del cobro no es un número válido')
  const formaPago = formulario.forma_pago_id.trim()
  const cuentaCobro = formulario.cuenta_cobro_id.trim()
  return {
    p_comprobante_id: comprobanteId,
    p_importe: importe,
    p_forma_pago_id: formaPago === '' ? null : formaPago,
    p_cuenta_cobro_id: cuentaCobro === '' ? null : cuentaCobro,
    p_actualizado_en: null,
  }
}

export async function registrarCobro(comprobanteId: string, formulario: FormularioCobro): Promise<CobroRegistrado> {
  const { data, error } = await supabaseClient.rpc('registrar_cobro', aParametrosRegistrar(comprobanteId, formulario))
  if (error) throw error
  const fila = data as CobroRegistrado
  return { ...fila, importe: Number(fila.importe) }
}

export async function cobrosDeComprobante(comprobanteId: string): Promise<Cobro[]> {
  const { data, error } = await supabaseClient.rpc('cobros_de_comprobante', { p_comprobante_id: comprobanteId })
  if (error) throw error
  const filas = (data ?? []) as Array<Omit<Cobro, 'importe'> & { importe: number | string }>
  return filas.map((fila) => ({ ...fila, importe: Number(fila.importe) }))
}

export async function saldoComprobante(comprobanteId: string): Promise<SaldoComprobante> {
  const { data, error } = await supabaseClient.rpc('saldo_comprobante', { p_id: comprobanteId })
  if (error) throw error
  const fila = ((data ?? []) as Array<{ total?: number | string; cobrado?: number | string; saldo?: number | string }>)[0]
  return {
    total: Number(fila?.total ?? 0),
    cobrado: Number(fila?.cobrado ?? 0),
    saldo: Number(fila?.saldo ?? 0),
  }
}

// Permiso de la acción `registrar_cobro` en la empresa del comprobante (FR-007): el detalle
// muestra el botón «Registrar cobro» solo con la acción. La base vuelve a verificarlo al
// registrar; esta lectura es para no ofrecer lo que la base va a rechazar.
export async function puedeRegistrarCobro(empresaId: string): Promise<boolean> {
  const { data, error } = await supabaseClient.rpc('puede_registrar_cobro', { p_empresa_id: empresaId })
  if (error) throw error
  return data === true
}

// Un cobro se registra solo sobre una FACTURA que ya se confirmó y no se anuló (FR-002 y el
// escenario 5 de US1): un borrador, un presupuesto o una nota de crédito no admiten cobros.
// La base rechaza esos casos igual; esta regla evita ofrecer una acción que va a fallar
// después de que la persona complete el formulario.
export function comprobanteAdmiteCobros(comprobante: Pick<Comprobante, 'tipo' | 'estado'>): boolean {
  return (
    comprobante.tipo === 'factura' &&
    comprobante.estado !== 'borrador' &&
    comprobante.estado !== 'anulada'
  )
}

// «Banco · Titular» como lo muestra el prototipo; si falta el banco o el titular, el que haya.
// Sin cuenta de cobro devuelve null: el campo queda vacío.
export function textoCuentaCobro(cobro: Cobro): string | null {
  const nombre = cobro.cuenta_cobro?.trim() ?? ''
  const banco = cobro.cuenta_cobro_banco?.trim() ?? ''
  const titular = cobro.cuenta_cobro_titular?.trim() ?? ''
  if (nombre === '' && banco === '' && titular === '') return null
  return etiquetaCuentaCobro({ nombre, banco: banco === '' ? null : banco, titular: titular === '' ? null : titular })
}

// El contrarreembolso se distingue por el TIPO de la forma de pago, no por su nombre (FR-008).
export function esContrarreembolso(cobro: Cobro): boolean {
  return cobro.forma_pago_tipo === 'contrarreembolso'
}
