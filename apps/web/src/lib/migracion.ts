// F-MIG-01 (MSF-299, FR-001…FR-009): contrato del asistente de importación.
//
// Es genérico por entidad (FR-001): la definición dice qué campos mapear y qué
// RPC usa la entidad; este módulo arma las filas, llama a las RPC de
// `public` (security definer) y normaliza sus respuestas. Ninguna escritura
// directa a tablas y ninguna service-role: viaja la sesión del Administrador.

import type { SupabaseClient } from '@supabase/supabase-js'
import { generarCsv, type CsvLeido } from './migracionCsv'

export type CampoEntidad = {
  clave: string
  etiqueta: string
  obligatorio?: boolean
  /** Encabezados habituales con los que se auto-mapea la columna. */
  alias?: readonly string[]
}

export type DefinicionEntidad = {
  id: string
  etiqueta: string
  sustantivo: string
  sustantivoPlural: string
  descripcion: string
  campos: readonly CampoEntidad[]
  rpcPrevisualizar: string
  rpcAplicar: string
  archivoPlantilla: string
  /** Campo que identifica la fila para detectar repetidos en el archivo (por defecto `id_externo`). */
  campoClave?: string
  /** La clave se compara sin distinguir mayúsculas (p. ej. SKU). */
  claveSinMayusculas?: boolean
  /** Paso que sigue en el orden de carga: se ofrece al terminar la importación. */
  siguiente?: { ruta: string; etiqueta: string }
}

export type FilaMigracion = { fila: number } & Record<string, string | number>

export type EstadoFila = 'nueva' | 'actualizada' | 'error'

export type ResultadoFila = {
  fila: number
  estado: EstadoFila
  motivo: string | null
}

export type ErrorFila = { fila: number; motivo: string }

export type ResultadoLote = {
  nuevos: number
  actualizados: number
  omitidos: number
  errores: ErrorFila[]
}

export type InformeCarga = {
  carga: string
  entidad: string
  archivo: string
  estado: 'aplicada' | 'fallida'
  error: string | null
  filas_total: number
  nuevos: number
  actualizados: number
  con_error: number
  errores: ErrorFila[]
}

// La base limita cada lote a 500 filas (FR-005).
export const TAMANO_LOTE_MIGRACION = 500

type ClienteMigracion = Pick<SupabaseClient, 'rpc'>

const ESTADOS_FILA: readonly EstadoFila[] = ['nueva', 'actualizada', 'error']

function normalizarEncabezado(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Auto-mapea las columnas cuyo encabezado coincide con la etiqueta o un alias
 * del campo. Nunca asigna dos columnas al mismo campo: la primera gana.
 */
export function mapeoAutomatico(
  definicion: DefinicionEntidad,
  encabezados: readonly string[],
): Record<number, string> {
  const usados = new Set<string>()
  const mapeo: Record<number, string> = {}
  encabezados.forEach((encabezado, indice) => {
    const normalizado = normalizarEncabezado(encabezado)
    const campo = definicion.campos.find((candidato) => {
      if (usados.has(candidato.clave)) return false
      const nombres = [candidato.etiqueta, ...(candidato.alias ?? [])]
      return nombres.some((nombre) => normalizarEncabezado(nombre) === normalizado)
    })
    if (campo) {
      mapeo[indice] = campo.clave
      usados.add(campo.clave)
    }
  })
  return mapeo
}

/** Etiquetas de los campos obligatorios que todavía no tienen columna. */
export function camposObligatoriosFaltantes(
  definicion: DefinicionEntidad,
  mapeo: Readonly<Record<number, string>>,
): string[] {
  const asignados = new Set(Object.values(mapeo))
  return definicion.campos
    .filter((campo) => campo.obligatorio && !asignados.has(campo.clave))
    .map((campo) => campo.etiqueta)
}

/** Columnas repetidas: no se permite mapear dos columnas al mismo campo. */
export function camposRepetidos(mapeo: Readonly<Record<number, string>>): string[] {
  const vistos = new Set<string>()
  const repetidos = new Set<string>()
  for (const clave of Object.values(mapeo)) {
    if (!clave) continue
    if (vistos.has(clave)) repetidos.add(clave)
    vistos.add(clave)
  }
  return [...repetidos]
}

export function construirFilas(csv: CsvLeido, mapeo: Readonly<Record<number, string>>): FilaMigracion[] {
  return csv.filas.map((fila) => {
    const datos: FilaMigracion = { fila: fila.numero }
    for (const [indice, clave] of Object.entries(mapeo)) {
      if (!clave) continue
      datos[clave] = fila.celdas[Number(indice)] ?? ''
    }
    return datos
  })
}

export function contarEstados(resultados: readonly ResultadoFila[]): Record<EstadoFila, number> {
  return resultados.reduce(
    (totales, resultado) => {
      totales[resultado.estado] += 1
      return totales
    },
    { nueva: 0, actualizada: 0, error: 0 },
  )
}

/**
 * Marca como error las filas cuyo identificador externo repite el de una fila
 * anterior válida. La base lo vuelve a validar al aplicar (la primera fila
 * válida gana); adelantarlo acá hace que la vista previa diga lo mismo que el
 * resultado y que esas filas no se presenten como importables (FR-004).
 */
export function marcarIdentificadoresRepetidos(
  filas: readonly FilaMigracion[],
  resultados: readonly ResultadoFila[],
  campo = 'id_externo',
  sinMayusculas = false,
): ResultadoFila[] {
  const porFila = new Map(resultados.map((resultado) => [resultado.fila, resultado]))
  const vistos = new Set<string>()
  for (const fila of filas) {
    const resultado = porFila.get(fila.fila)
    if (!resultado || resultado.estado === 'error') continue
    const crudo = String(fila[campo] ?? '').trim()
    const identificador = sinMayusculas ? crudo.toLowerCase() : crudo
    if (identificador === '') continue
    if (vistos.has(identificador)) {
      porFila.set(fila.fila, {
        fila: fila.fila,
        estado: 'error',
        motivo: campo === 'id_externo' ? 'El identificador está repetido en el archivo' : 'El SKU está repetido en el archivo',
      })
    } else {
      vistos.add(identificador)
    }
  }
  return resultados.map((resultado) => porFila.get(resultado.fila) ?? resultado)
}

/** Agrupa las filas con error por motivo para el aviso de la vista previa (FR-004). */
export function erroresPorMotivo(resultados: readonly ResultadoFila[]): Array<{ motivo: string; filas: number[] }> {
  const grupos = new Map<string, number[]>()
  for (const resultado of resultados) {
    if (resultado.estado !== 'error') continue
    const motivo = resultado.motivo?.trim() || 'La fila no pasó la validación.'
    grupos.set(motivo, [...(grupos.get(motivo) ?? []), resultado.fila])
  }
  return [...grupos.entries()]
    .map(([motivo, filas]) => ({ motivo, filas: [...filas].sort((a, b) => a - b) }))
    .sort((a, b) => a.filas[0] - b.filas[0])
}

export function contenidoPlantilla(definicion: DefinicionEntidad): string {
  return generarCsv(definicion.campos.map((campo) => campo.etiqueta))
}

export function mensajeDeErrorMigracion(error: unknown, porDefecto: string): string {
  const codigo = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : ''
  if (codigo === '42501') return 'Solo un administrador puede importar datos.'
  if (codigo === 'P0002') return 'La carga ya no existe en tu organización.'
  if (codigo === '54000') return 'El lote supera el máximo de 500 filas.'
  // Solo el código: el error crudo de PostgREST puede traer datos de la fila (PII).
  console.error(porDefecto, codigo || 'sin código')
  return porDefecto
}

function entero(valor: unknown): number {
  const numero = typeof valor === 'number' ? valor : Number(valor)
  return Number.isFinite(numero) && numero >= 0 ? Math.trunc(numero) : 0
}

function leerResultadoFila(valor: unknown): ResultadoFila | null {
  if (!valor || typeof valor !== 'object') return null
  const fila = valor as Record<string, unknown>
  const numero = Number(fila.fila)
  if (!Number.isInteger(numero) || numero <= 0) return null
  const estado = typeof fila.estado === 'string' && (ESTADOS_FILA as readonly string[]).includes(fila.estado)
    ? (fila.estado as EstadoFila)
    : 'error'
  return {
    fila: numero,
    estado,
    motivo: typeof fila.motivo === 'string' ? fila.motivo : null,
  }
}

function leerErrores(valor: unknown): ErrorFila[] {
  if (!Array.isArray(valor)) return []
  return valor.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const error = item as Record<string, unknown>
    const fila = Number(error.fila)
    if (!Number.isInteger(fila) || fila <= 0 || typeof error.motivo !== 'string') return []
    return [{ fila, motivo: error.motivo }]
  })
}

export function leerResultadosPrevisualizacion(valor: unknown): ResultadoFila[] {
  if (!Array.isArray(valor)) {
    throw new Error('La base no devolvió la vista previa esperada.')
  }
  return valor.flatMap((item) => {
    const resultado = leerResultadoFila(item)
    return resultado ? [resultado] : []
  })
}

export function leerResultadoLote(valor: unknown): ResultadoLote {
  if (!valor || typeof valor !== 'object') {
    throw new Error('La base no devolvió el resultado del lote esperado.')
  }
  const lote = valor as Record<string, unknown>
  return {
    nuevos: entero(lote.nuevos),
    actualizados: entero(lote.actualizados),
    omitidos: entero(lote.omitidos),
    errores: leerErrores(lote.errores),
  }
}

export function leerInforme(valor: unknown): InformeCarga {
  if (!valor || typeof valor !== 'object') {
    throw new Error('La base no devolvió el informe de la carga.')
  }
  const informe = valor as Record<string, unknown>
  return {
    carga: String(informe.carga ?? ''),
    entidad: String(informe.entidad ?? ''),
    archivo: String(informe.archivo ?? ''),
    estado: informe.estado === 'aplicada' ? 'aplicada' : 'fallida',
    error: typeof informe.error === 'string' ? informe.error : null,
    filas_total: entero(informe.filas_total),
    nuevos: entero(informe.nuevos),
    actualizados: entero(informe.actualizados),
    con_error: entero(informe.con_error),
    errores: leerErrores(informe.errores),
  }
}

export async function iniciarCargaMigracion(
  cliente: ClienteMigracion,
  entidad: string,
  archivo: string,
  filasTotal: number,
): Promise<string> {
  const { data, error } = await cliente.rpc('iniciar_carga_migracion', {
    p_entidad: entidad,
    p_archivo: archivo,
    p_filas_total: filasTotal,
  })
  if (error) throw error
  if (typeof data !== 'string' || data === '') {
    throw new Error('La base no devolvió la carga creada.')
  }
  return data
}

function enLotes<T>(filas: readonly T[], tamano = TAMANO_LOTE_MIGRACION): T[][] {
  const lotes: T[][] = []
  for (let indice = 0; indice < filas.length; indice += tamano) {
    lotes.push(filas.slice(indice, indice + tamano))
  }
  return lotes
}

/** Vista previa por lotes de hasta 500 filas: solo lee, no escribe (FR-004). */
export async function previsualizarFilas(
  cliente: ClienteMigracion,
  definicion: DefinicionEntidad,
  filas: readonly FilaMigracion[],
): Promise<ResultadoFila[]> {
  const resultados: ResultadoFila[] = []
  for (const lote of enLotes(filas)) {
    const { data, error } = await cliente.rpc(definicion.rpcPrevisualizar, { p_filas: lote })
    if (error) throw error
    resultados.push(...leerResultadosPrevisualizacion(data))
  }
  return resultados.sort((a, b) => a.fila - b.fila)
}

/**
 * Aplica todos los lotes con la misma carga. Reintentar con la misma carga es
 * seguro: la RPC omite las filas ya aplicadas (FR-006).
 */
export async function aplicarLotes(
  cliente: ClienteMigracion,
  definicion: DefinicionEntidad,
  carga: string,
  filas: readonly FilaMigracion[],
  alProgresar?: (lotesHechos: number, lotesTotal: number) => void,
): Promise<ResultadoLote[]> {
  const lotes = enLotes(filas)
  const resultados: ResultadoLote[] = []
  for (const [indice, lote] of lotes.entries()) {
    const { data, error } = await cliente.rpc(definicion.rpcAplicar, {
      p_carga: carga,
      p_lote: indice + 1,
      p_filas: lote,
    })
    if (error) throw error
    resultados.push(leerResultadoLote(data))
    alProgresar?.(indice + 1, lotes.length)
  }
  return resultados
}

export async function cerrarCargaMigracion(
  cliente: ClienteMigracion,
  carga: string,
): Promise<InformeCarga> {
  const { data, error } = await cliente.rpc('cerrar_carga_migracion', { p_carga: carga })
  if (error) throw error
  return leerInforme(data)
}
