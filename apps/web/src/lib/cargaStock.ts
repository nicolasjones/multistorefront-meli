import { supabaseClient } from './supabase'
import { descargarArchivo } from './exportarClientes'

// Carga inicial y masiva de stock por planilla (F-STK-07, MSF-380). La planilla se lee en el navegador;
// las reglas de cada fila las evalúa el servidor (`validar_carga_stock`, migración
// 20261206100100_stock_carga_inicial_rpc.sql) y `aplicar_carga_inicial_stock` revalida todo. Acá solo
// se normaliza la planilla y se rotula: la autoridad es la base (RLS y nivel `edicion` en Stock).

export const MAXIMO_FILAS_CARGA = 2000
export const NOMBRE_PLANTILLA = 'stock.xlsx'
export const MENSAJE_PLANTILLA_DESCARGADA = 'Plantilla stock.xlsx descargada'
export const COLUMNAS_PLANTILLA = ['sku', 'cantidad', 'motivo'] as const

export class ErrorPlanilla extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorPlanilla'
  }
}

/** Fila de la planilla ya normalizada; `fila` es el número de fila en la hoja (el encabezado es la 1). */
export type FilaPlanilla = { fila: number; sku: string; cantidad: string; motivo: string | null }

export type PlanillaLeida = { filas: FilaPlanilla[] }

export type EstadoFilaCarga = 'ajuste' | 'sin_cambios' | 'error'

export type FilaValidada = {
  fila: number
  sku: string
  producto: string | null
  stock_actual: number | null
  en_planilla: number | null
  quedara: number | null
  diferencia: number | null
  estado: EstadoFilaCarga
  mensaje: string
}

export type DetalleAplicado = { fila: number | null; sku: string; estado: string; mensaje: string }

export type ResultadoCarga = {
  aplicadas: number
  omitidas: number
  repetido: boolean
  detalle: DetalleAplicado[]
}

type Celda = string | number | boolean | Date | null | undefined | object

// Un valor numérico se lee como texto (un SKU «1234» llega como número); fechas y celdas vacías, como vacío.
function textoDeCelda(celda: Celda): string {
  if (celda === null || celda === undefined) return ''
  if (typeof celda === 'string') return celda.trim()
  if (typeof celda === 'number' || typeof celda === 'boolean') return String(celda)
  return ''
}

const normalizarEncabezado = (celda: Celda) => textoDeCelda(celda).toLowerCase()

// Convierte la primera hoja (filas de celdas) en filas de planilla. Reglas de FR-004: se ignoran las filas en
// blanco; se rechaza una hoja vacía, sin encabezado `sku` o `cantidad`, o con más filas que el tope técnico.
export function normalizarHoja(hoja: readonly (readonly Celda[])[]): PlanillaLeida {
  if (hoja.length === 0) throw new ErrorPlanilla('La planilla está vacía.')
  const encabezados = hoja[0].map(normalizarEncabezado)
  const columnaSku = encabezados.indexOf('sku')
  const columnaCantidad = encabezados.indexOf('cantidad')
  const columnaMotivo = encabezados.indexOf('motivo')
  if (columnaSku === -1 || columnaCantidad === -1) {
    throw new ErrorPlanilla('La primera fila debe tener los encabezados «sku» y «cantidad».')
  }

  const filas: FilaPlanilla[] = []
  hoja.slice(1).forEach((celdas, indice) => {
    const sku = textoDeCelda(celdas[columnaSku])
    const cantidad = textoDeCelda(celdas[columnaCantidad])
    const motivo = columnaMotivo === -1 ? '' : textoDeCelda(celdas[columnaMotivo])
    if (sku === '' && cantidad === '' && motivo === '') return
    filas.push({ fila: indice + 2, sku, cantidad, motivo: motivo === '' ? null : motivo })
  })

  if (filas.length === 0) throw new ErrorPlanilla('La planilla no tiene filas con datos.')
  if (filas.length > MAXIMO_FILAS_CARGA) {
    throw new ErrorPlanilla(`La planilla tiene más de ${MAXIMO_FILAS_CARGA.toLocaleString('es-AR')} filas. Dividila en archivos más chicos.`)
  }
  return { filas }
}

// Lee el .xlsx en el navegador (primera hoja). La librería se descarga recién acá (import diferido):
// no pesa en el recorrido principal.
export async function leerPlanilla(archivo: File): Promise<PlanillaLeida> {
  if (!/\.xlsx$/i.test(archivo.name)) throw new ErrorPlanilla('El archivo debe ser una planilla Excel (.xlsx).')
  let hoja: Celda[][]
  try {
    const { readSheet } = await import('read-excel-file/browser')
    hoja = (await readSheet(archivo)) as Celda[][]
  } catch (error) {
    console.error('lectura del .xlsx falló', error)
    throw new ErrorPlanilla('No pudimos leer el archivo. Verificá que sea un .xlsx válido.')
  }
  return normalizarHoja(hoja)
}

export async function armarPlantilla(): Promise<Blob> {
  const { default: escribirXlsx } = await import('write-excel-file/browser')
  const encabezados = COLUMNAS_PLANTILLA.map((nombre) => ({ type: String, value: nombre, fontWeight: 'bold' as const }))
  return escribirXlsx(
    [encabezados],
    { sheet: 'Stock', columns: COLUMNAS_PLANTILLA.map(() => ({ width: 18 })), stickyRowsCount: 1 },
  ).toBlob()
}

export async function descargarPlantilla(): Promise<void> {
  descargarArchivo(await armarPlantilla(), NOMBRE_PLANTILLA)
}

export function filasParaRpc(filas: readonly FilaPlanilla[]) {
  return filas.map(({ fila, sku, cantidad, motivo }) => ({ fila, sku, cantidad, motivo }))
}

export async function validarCarga(deposito: string, filas: readonly FilaPlanilla[]): Promise<FilaValidada[]> {
  const { data, error } = await supabaseClient.rpc('validar_carga_stock', { p_deposito: deposito, p_filas: filasParaRpc(filas) })
  if (error) throw error
  return (data ?? []) as FilaValidada[]
}

export async function aplicarCarga(deposito: string, filas: readonly FilaPlanilla[], clave: string): Promise<ResultadoCarga> {
  const { data, error } = await supabaseClient.rpc('aplicar_carga_inicial_stock', {
    p_deposito: deposito, p_filas: filasParaRpc(filas), p_clave: clave,
  })
  if (error) throw error
  return data as ResultadoCarga
}

export const contarCambios = (filas: readonly FilaValidada[]) => filas.filter((fila) => fila.estado === 'ajuste').length
export const contarErrores = (filas: readonly FilaValidada[]) => filas.filter((fila) => fila.estado === 'error').length

export function rotularDiferencia(diferencia: number | null): string {
  if (diferencia === null) return '—'
  return diferencia > 0 ? `+${diferencia}` : String(diferencia)
}

export function mensajeDeErrorCarga(error: unknown, porDefecto: string): string {
  console.error(porDefecto, error)
  const e = error as { code?: string; message?: string } | null
  if (e?.code === '42501') return 'No tenés permiso para cargar stock. Puede que tu rol haya cambiado: recargá la página.'
  if (e?.code === '22023' && e.message) return e.message
  return porDefecto
}
