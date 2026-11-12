// Actualización masiva de costos y precios (F-PRE-10, MSF-436). La autoridad es la base: las RPC
// `previsualizar_actualizacion_precios` y `aplicar_actualizacion_precios` (migraciones 20270221100007 y
// 20270221100008) revalidan todo. Acá: la planilla CSV (plantilla y lectura, sobre `migracionCsv`), la
// validación previa al viaje y las llamadas a las RPC con sus mensajes de error.
import type { SupabaseClient } from '@supabase/supabase-js'
import { generarCsv, type CsvLeido } from './migracionCsv'

export const MAXIMO_FILAS_PLANILLA = 5000
export const NOMBRE_PLANTILLA = 'plantilla-actualizacion-precios.csv'
export const COLUMNAS_PLANTILLA = ['SKU', 'costo', 'precio_lista'] as const

export type ModoActualizacion = 'porcentaje' | 'planilla'
export type QueCambia = 'costo' | 'precio_lista' | 'ambos'

export type ParametrosPorcentaje = { cambia: QueCambia; alcance: 'todos' | string; porcentaje: number }
export type FilaPlanilla = { fila: number; sku: string; costo?: number; precio_lista?: number }
export type ParametrosPlanilla = { filas: FilaPlanilla[] }
export type ErrorFilaPlanilla = { fila: number; motivo: string }

export type FilaVistaPrevia = {
  fila: number | null
  producto_id: string | null
  sku: string | null
  nombre: string | null
  moneda: string | null
  lista_antes: number | null
  lista_despues: number | null
  // Solo llegan con la sección Rentabilidad.
  costo_antes?: number | null
  costo_despues?: number | null
  actualizado: string | null
  error: string | null
  cambia: boolean
}

export type VistaPrevia = { afectados: number; sin_cambio: number; con_error: number; filas: FilaVistaPrevia[] }

export class ErrorPlanilla extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorPlanilla'
  }
}

export function plantillaCsv(): string {
  return generarCsv(COLUMNAS_PLANTILLA)
}

const NUMERO = /^\d{1,12}([.,]\d{1,2})?$/

function aNumero(texto: string): number | null {
  const limpio = texto.trim()
  if (!NUMERO.test(limpio)) return null
  return Number(limpio.replace(',', '.'))
}

function claveColumna(encabezado: string): string {
  return encabezado.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

/**
 * Convierte el CSV leído en filas para la RPC. Los errores de formato (SKU vacío, números inválidos,
 * celdas de más) salen por fila y con su número; la base vuelve a validar todo.
 * Lanza `ErrorPlanilla` si faltan columnas o no hay filas.
 */
export function leerPlanilla(csv: CsvLeido, puedeCargarCosto: boolean): { filas: FilaPlanilla[]; errores: ErrorFilaPlanilla[] } {
  const claves = csv.encabezados.map(claveColumna)
  const columnaSku = claves.indexOf('sku')
  const columnaCosto = claves.indexOf('costo')
  const columnaLista = claves.indexOf('precio_lista')
  if (columnaSku < 0) throw new ErrorPlanilla('Falta la columna SKU. Descargá la plantilla y completala.')
  if (columnaCosto < 0 && columnaLista < 0) {
    throw new ErrorPlanilla('Falta al menos una columna: costo o precio_lista. Descargá la plantilla y completala.')
  }
  if (csv.filas.length === 0) throw new ErrorPlanilla('La planilla no tiene filas.')
  if (csv.filas.length > MAXIMO_FILAS_PLANILLA) {
    throw new ErrorPlanilla(`La planilla admite hasta ${MAXIMO_FILAS_PLANILLA.toLocaleString('es-AR')} filas por vez.`)
  }

  const filas: FilaPlanilla[] = []
  const errores: ErrorFilaPlanilla[] = []
  for (const registro of csv.filas) {
    const sku = (registro.celdas[columnaSku] ?? '').trim()
    const textoCosto = columnaCosto >= 0 ? (registro.celdas[columnaCosto] ?? '').trim() : ''
    const textoLista = columnaLista >= 0 ? (registro.celdas[columnaLista] ?? '').trim() : ''
    const fila: FilaPlanilla = { fila: registro.numero, sku }
    let motivo: string | null = registro.error ?? null

    if (motivo === null && sku === '') motivo = 'Falta el SKU.'
    if (motivo === null && textoCosto !== '') {
      const costo = aNumero(textoCosto)
      if (costo === null) motivo = 'El costo no es un número válido (hasta 2 decimales, sin IVA).'
      else if (!puedeCargarCosto) motivo = 'Tu rol no puede cargar costos: quitá la columna costo.'
      else fila.costo = costo
    }
    if (motivo === null && textoLista !== '') {
      const lista = aNumero(textoLista)
      if (lista === null) motivo = 'El precio de lista no es un número válido (hasta 2 decimales, sin IVA).'
      else fila.precio_lista = lista
    }
    if (motivo === null && fila.costo === undefined && fila.precio_lista === undefined) {
      motivo = 'Cargá el costo, el precio de lista o ambos.'
    }
    if (motivo !== null) errores.push({ fila: registro.numero, motivo })
    else filas.push(fila)
  }
  return { filas, errores }
}

/** Porcentaje escrito por la persona («10», «-5,5»): número mayor a −100 o `null` si no sirve. */
export function leerPorcentaje(texto: string): number | null {
  const limpio = texto.trim().replace(',', '.')
  if (!/^-?\d{1,6}(\.\d{1,4})?$/.test(limpio)) return null
  const valor = Number(limpio)
  return valor > -100 && valor <= 100000 ? valor : null
}

type ErrorRpc = { code?: string; message?: string; details?: string } | null

export const MENSAJE_CONFLICTO = 'Un producto cambió desde la vista previa. No se aplicó nada: generá la vista previa de nuevo.'
const MENSAJE_GENERICO = 'No pudimos completar la operación. Probá de nuevo en unos minutos.'

export function esConflicto(error: ErrorRpc): boolean {
  return error?.code === '40001'
}

// La base ya trae el texto en castellano en 42501, 22023, 54000 y 55000; el resto es genérico.
export function mensajeErrorActualizacion(error: ErrorRpc): string {
  if (esConflicto(error)) return MENSAJE_CONFLICTO
  if (error?.code === '42501' || error?.code === '22023' || error?.code === '54000' || error?.code === '55000') return error.message || MENSAJE_GENERICO
  return MENSAJE_GENERICO
}

export async function previsualizarActualizacion(
  cliente: Pick<SupabaseClient, 'rpc'>,
  modo: ModoActualizacion,
  parametros: ParametrosPorcentaje | ParametrosPlanilla,
): Promise<VistaPrevia> {
  const { data, error } = await cliente.rpc('previsualizar_actualizacion_precios', { p_modo: modo, p_parametros: parametros })
  if (error) throw error
  return data as VistaPrevia
}

/** Versiones (`updated_at`) de la vista previa: la base rechaza el lote si alguna cambió. */
export function versionesDe(vista: VistaPrevia): Record<string, string> {
  const versiones: Record<string, string> = {}
  for (const fila of vista.filas) {
    if (fila.producto_id && fila.actualizado) versiones[fila.producto_id] = fila.actualizado
  }
  return versiones
}

export async function aplicarActualizacion(
  cliente: Pick<SupabaseClient, 'rpc'>,
  modo: ModoActualizacion,
  parametros: ParametrosPorcentaje | ParametrosPlanilla,
  vista: VistaPrevia,
  clave: string,
): Promise<{ lote_id: string; aplicados: number; repetido: boolean }> {
  const { data, error } = await cliente.rpc('aplicar_actualizacion_precios', {
    p_modo: modo,
    p_parametros: { ...parametros, versiones: versionesDe(vista) },
    p_clave: clave,
  })
  if (error) throw error
  return data as { lote_id: string; aplicados: number; repetido: boolean }
}
