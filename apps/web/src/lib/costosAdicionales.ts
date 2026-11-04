import type { SupabaseClient } from '@supabase/supabase-js'
import { formatearPesos } from './formatoRanking'

// Costos adicionales del canal (F-REN-08, spec `rentabilidad-real-y-reportes-de-ventas`). La autoridad es
// la base (migraciones 20270201100000 y 20270201100010: `listar_costos_adicionales`,
// `guardar_costo_adicional`, `dar_baja_costo_adicional`); acá se espeja SOLO la validación para dar
// feedback mientras se escribe y se traducen los códigos de error a mensajes de negocio.

export type TipoCostoAdicional = 'porcentaje' | 'monto'

export type CostoAdicional = {
  id: string
  empresaId: string
  empresaNombre: string
  nombre: string
  tipo: TipoCostoAdicional
  // porcentaje: 0–100 sobre el neto · monto: pesos por unidad.
  valor: number
}

type CostoRpc = {
  id: string
  empresa_id: string
  empresa_nombre: string
  nombre: string
  tipo: TipoCostoAdicional
  valor: number | string
}

export const TIPOS_COSTO: ReadonlyArray<{ valor: TipoCostoAdicional; etiqueta: string }> = [
  { valor: 'porcentaje', etiqueta: 'Porcentaje sobre el neto' },
  { valor: 'monto', etiqueta: 'Monto por unidad' },
]

export const NOMBRE_MAX = 80
export const MENSAJE_NOMBRE_OBLIGATORIO = 'Ingresá un nombre para el costo.'
export const MENSAJE_NOMBRE_LARGO = `El nombre admite hasta ${NOMBRE_MAX} caracteres.`
export const MENSAJE_VALOR_INVALIDO = 'Ingresá un valor mayor o igual a 0, por ejemplo 5 o 12,5.'
export const MENSAJE_PORCENTAJE_FUERA_DE_RANGO = 'El porcentaje debe estar entre 0 y 100.'
export const MENSAJE_SIN_EMPRESA = 'Elegí al menos una empresa a la que aplica.'

const FORMATO_VALOR = /^\d+(?:,\d{1,2})?$/
const formatoNumero = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })

// El campo solo admite dígitos y coma decimal (como el resto de los campos numéricos del panel).
export const soloCaracteresDeValor = (texto: string) => texto.replace(/[^0-9,]/g, '')

// Texto del campo → número, o null si no es válido (vacío o con formato raro).
export function parsearValorCosto(texto: string): number | null {
  const limpio = texto.trim()
  if (!FORMATO_VALOR.test(limpio)) return null
  return Number(limpio.replace(',', '.'))
}

export const valorATexto = (valor: number) => formatoNumero.format(valor)

export type ErroresCostoAdicional = { nombre?: string; valor?: string; empresas?: string }

export function validarCostoAdicional(entrada: {
  nombre: string
  tipo: TipoCostoAdicional
  valorTexto: string
  empresaIds: ReadonlyArray<string>
}): ErroresCostoAdicional {
  const errores: ErroresCostoAdicional = {}
  const nombre = entrada.nombre.trim()
  if (nombre === '') errores.nombre = MENSAJE_NOMBRE_OBLIGATORIO
  else if (nombre.length > NOMBRE_MAX) errores.nombre = MENSAJE_NOMBRE_LARGO
  const valor = parsearValorCosto(entrada.valorTexto)
  if (valor === null) errores.valor = MENSAJE_VALOR_INVALIDO
  else if (entrada.tipo === 'porcentaje' && valor > 100) errores.valor = MENSAJE_PORCENTAJE_FUERA_DE_RANGO
  if (entrada.empresaIds.length === 0) errores.empresas = MENSAJE_SIN_EMPRESA
  return errores
}

export const formatearValorCosto = (costo: Pick<CostoAdicional, 'tipo' | 'valor'>) =>
  costo.tipo === 'porcentaje' ? `${valorATexto(costo.valor)} %` : `${formatearPesos(costo.valor)} por unidad`

// Mensaje claro según el código de la base; nunca el texto técnico.
export function mensajeDeErrorCosto(error: { code?: string } | null | undefined, empresaNombre?: string): string {
  switch (error?.code) {
    case '42501': return 'Tu rol no puede editar los costos adicionales de esta empresa.'
    case '23505': return `Ya hay un costo con ese nombre${empresaNombre ? ` en ${empresaNombre}` : ' en esa empresa'}.`
    case '23514': return MENSAJE_VALOR_INVALIDO
    case 'P0002': return 'Este costo ya no existe. Actualizá la lista.'
    default: return 'No pudimos guardar el costo. Intentá de nuevo.'
  }
}

const aCosto = (fila: CostoRpc): CostoAdicional => ({
  id: fila.id,
  empresaId: fila.empresa_id,
  empresaNombre: fila.empresa_nombre,
  nombre: fila.nombre,
  tipo: fila.tipo,
  valor: Number(fila.valor),
})

export async function listarCostosAdicionales(cliente: SupabaseClient, empresaId: string | null): Promise<CostoAdicional[]> {
  const { data, error } = await cliente.rpc('listar_costos_adicionales', { p_empresa_id: empresaId })
  if (error) throw error
  return ((data ?? []) as CostoRpc[]).map(aCosto)
}

export async function guardarCostoAdicional(
  cliente: SupabaseClient,
  costo: { id: string | null; empresaId: string; nombre: string; tipo: TipoCostoAdicional; valor: number },
): Promise<void> {
  const { error } = await cliente.rpc('guardar_costo_adicional', {
    p_id: costo.id,
    p_empresa_id: costo.empresaId,
    p_nombre: costo.nombre.trim(),
    p_tipo: costo.tipo,
    p_valor: costo.valor,
  })
  if (error) throw error
}

export async function darDeBajaCostoAdicional(cliente: SupabaseClient, id: string): Promise<void> {
  const { error } = await cliente.rpc('dar_baja_costo_adicional', { p_id: id })
  if (error) throw error
}
