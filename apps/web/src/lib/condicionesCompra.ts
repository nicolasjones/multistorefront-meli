import type { SupabaseClient } from '@supabase/supabase-js'
import { mensajeDeErrorBase } from './mensajeErrorBase'
import { parsearImporte } from './productos'

// Condiciones de compra del proveedor (plazo de pago, mínimo de compra, moneda y notas). La autoridad es la base
// (migración 20270511000000): las RPC `obtener_condiciones_compra_proveedor` y `guardar_condiciones_compra_proveedor`
// validan rol, organización y datos. Acá se valida lo mínimo para avisar antes de enviar y se traducen los errores.

export type MonedaCondiciones = 'ARS' | 'USD'

export const MONEDAS_CONDICIONES: ReadonlyArray<{ valor: MonedaCondiciones; etiqueta: string }> = [
  { valor: 'ARS', etiqueta: 'ARS · pesos' },
  { valor: 'USD', etiqueta: 'USD · dólares' },
]

export const PLAZO_MAXIMO_DIAS = 365
export const LARGO_NOTAS = 1000

export type CondicionesCompra = {
  plazoPagoDias: number | null
  minimoCompra: number | null
  moneda: MonedaCondiciones | null
  notas: string | null
  // Texto exacto que devolvió la base: es el control de concurrencia (JavaScript pierde los microsegundos). Nulo = todavía no hay condiciones.
  actualizadoEn: string | null
}

export const SIN_CONDICIONES: CondicionesCompra = { plazoPagoDias: null, minimoCompra: null, moneda: null, notas: null, actualizadoEn: null }

export type FormularioCondiciones = { plazo: string; minimo: string; moneda: '' | MonedaCondiciones; notas: string }

export type ErroresCondiciones = Partial<Record<keyof FormularioCondiciones, string>>

type FilaCondiciones = {
  plazo_pago_dias: number | null
  minimo_compra: number | string | null
  moneda: MonedaCondiciones | null
  notas: string | null
  updated_at: string
}

export async function leerCondiciones(cliente: SupabaseClient, proveedorId: string): Promise<CondicionesCompra> {
  const { data, error } = await cliente.rpc('obtener_condiciones_compra_proveedor', { p_proveedor_id: proveedorId })
  if (error) throw error
  const fila = ((data ?? []) as FilaCondiciones[])[0]
  if (!fila) return SIN_CONDICIONES
  return {
    plazoPagoDias: fila.plazo_pago_dias,
    minimoCompra: fila.minimo_compra === null ? null : Number(fila.minimo_compra),
    moneda: fila.moneda,
    notas: fila.notas,
    actualizadoEn: fila.updated_at,
  }
}

export function aFormularioCondiciones(condiciones: CondicionesCompra): FormularioCondiciones {
  return {
    plazo: condiciones.plazoPagoDias === null ? '' : String(condiciones.plazoPagoDias),
    minimo: condiciones.minimoCompra === null ? '' : String(condiciones.minimoCompra).replace('.', ','),
    moneda: condiciones.moneda ?? '',
    notas: condiciones.notas ?? '',
  }
}

// Días enteros de 0 a 365 («0» = contado). Vacío = sin dato; inválido = undefined.
export function parsearPlazo(texto: string): number | null | undefined {
  const limpio = texto.trim()
  if (limpio === '') return null
  if (!/^\d{1,3}$/.test(limpio)) return undefined
  const valor = Number(limpio)
  return valor <= PLAZO_MAXIMO_DIAS ? valor : undefined
}

export function validarCondiciones(formulario: FormularioCondiciones): ErroresCondiciones {
  const errores: ErroresCondiciones = {}
  if (parsearPlazo(formulario.plazo) === undefined) errores.plazo = `Ingresá los días de plazo, de 0 a ${PLAZO_MAXIMO_DIAS}.`
  const minimo = formulario.minimo.trim()
  if (minimo !== '' && parsearImporte(minimo) === null) errores.minimo = 'Ingresá un monto válido, con hasta 2 decimales.'
  if (minimo !== '' && parsearImporte(minimo) !== null && formulario.moneda === '') errores.moneda = 'Elegí la moneda del mínimo de compra.'
  if (formulario.notas.trim().length > LARGO_NOTAS) errores.notas = `Las notas no pueden superar los ${LARGO_NOTAS} caracteres.`
  return errores
}

export function hayCambiosCondiciones(actual: FormularioCondiciones, inicial: FormularioCondiciones): boolean {
  return actual.plazo.trim() !== inicial.plazo.trim() || actual.minimo.trim() !== inicial.minimo.trim()
    || actual.moneda !== inicial.moneda || actual.notas.trim() !== inicial.notas.trim()
}

// Devuelve el nuevo `updated_at` (nulo si no había condiciones y no se cargó nada).
export async function guardarCondiciones(
  cliente: SupabaseClient,
  proveedorId: string,
  formulario: FormularioCondiciones,
  actualizadoEn: string | null,
): Promise<string | null> {
  const plazo = parsearPlazo(formulario.plazo)
  const minimo = formulario.minimo.trim() === '' ? null : parsearImporte(formulario.minimo)
  if (plazo === undefined || (formulario.minimo.trim() !== '' && minimo === null)) throw new Error('Las condiciones no son válidas')
  const { data, error } = await cliente.rpc('guardar_condiciones_compra_proveedor', {
    p_proveedor_id: proveedorId,
    p_plazo_pago_dias: plazo,
    p_minimo_compra: minimo,
    p_moneda: formulario.moneda === '' ? null : formulario.moneda,
    p_notas: formulario.notas.trim() === '' ? null : formulario.notas.trim(),
    p_actualizado: actualizadoEn,
  })
  if (error) throw error
  return (data as string | null) ?? null
}

export const MENSAJE_CONFLICTO_CONDICIONES =
  'Otra persona modificó las condiciones mientras las editabas. Recargá para ver sus cambios; no se guardó nada tuyo.'

export function mensajeErrorCondiciones(error: unknown, porDefecto: string): string {
  return mensajeDeErrorBase(error, porDefecto, {
    PT412: MENSAJE_CONFLICTO_CONDICIONES,
    '40001': MENSAJE_CONFLICTO_CONDICIONES,
    PT404: 'El proveedor ya no existe o no pertenece a tu organización.',
    P0002: 'El proveedor ya no existe o no pertenece a tu organización.',
    '22023': 'Algún dato no es válido. Revisá el formulario e intentá de nuevo.',
  })
}

export function esConflictoCondiciones(error: unknown): boolean {
  const codigo = (error as { code?: string } | null)?.code
  return codigo === 'PT412' || codigo === '40001'
}

// «30 días», «Contado», «Sin dato».
export function textoPlazo(dias: number | null): string {
  if (dias === null) return '—'
  if (dias === 0) return 'Contado'
  return dias === 1 ? '1 día' : `${dias} días`
}
