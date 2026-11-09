import { supabaseClient } from './supabase'
import type { ColumnaCsv } from './exportarCsv'
import { hoyEnOrganizacion } from './periodosRanking'

// Centro de importaciones y exportaciones (F-IMP-01, MSF-354): tipos y textos de los procesos masivos.
// Los textos viven acá para que tabla, diálogo y tests muestren lo mismo y nunca un identificador técnico.

export type EstadoProceso = 'pendiente' | 'en_curso' | 'completado' | 'con_errores' | 'fallido' | 'cancelado'

export type ProcesoMasivo = {
  id: string
  empresa_id: string | null
  tipo: 'importacion' | 'exportacion'
  funcionalidad: string
  nombre: string
  estado: EstadoProceso
  total: number | null
  procesados: number
  con_errores: number
  cancelacion_solicitada: boolean
  creado_en: string
  iniciado_en: string | null
  finalizado_en: string | null
}

export type ErrorProceso = {
  id: string
  fila: number | null
  columna: string | null
  referencia: string | null
  motivo_sanitizado: string
}

// Carga infinita (Constitución, Principio VI): tamaño de cada tanda que se suma a lo ya mostrado.
export const TAMANO_TANDA_PROCESOS = 20
export const TAMANO_TANDA_ERRORES = 20
export const COLUMNAS_ERROR = 'id, fila, columna, referencia, motivo_sanitizado'
export const REFRESCO_PROCESOS_MS = 5000

export const COLUMNAS_PROCESO = 'id, empresa_id, tipo, funcionalidad, nombre, estado, total, procesados, con_errores, cancelacion_solicitada, creado_en, iniciado_en, finalizado_en'

const ETIQUETA_ESTADO: Record<EstadoProceso, string> = {
  pendiente: 'Pendiente',
  en_curso: 'En curso',
  completado: 'Completado',
  con_errores: 'Con errores',
  fallido: 'Fallido',
  cancelado: 'Cancelado',
}

export function etiquetaEstado(proceso: Pick<ProcesoMasivo, 'estado' | 'cancelacion_solicitada'>): string {
  if (proceso.cancelacion_solicitada && estaAbierto(proceso.estado)) return 'Cancelando'
  return ETIQUETA_ESTADO[proceso.estado]
}

export function colorEstado(estado: EstadoProceso): 'default' | 'info' | 'success' | 'warning' | 'error' {
  switch (estado) {
    case 'en_curso': return 'info'
    case 'completado': return 'success'
    case 'con_errores': return 'warning'
    case 'fallido': return 'error'
    default: return 'default'
  }
}

export function estaAbierto(estado: EstadoProceso): boolean {
  return estado === 'pendiente' || estado === 'en_curso'
}

const ETIQUETA_FUNCIONALIDAD: Record<string, string> = {
  catalogo: 'Catálogo',
  productos: 'Productos',
  stock: 'Stock',
  'mercado-libre': 'Mercado Libre',
  'exportacion-total': 'Exportación total',
  exportacion_total: 'Exportación total',
  historial: 'Historial de ventas',
}

// Nombre legible de la funcionalidad de origen: nunca se muestra la clave técnica tal cual (FR-016).
export function etiquetaFuncionalidad(funcionalidad: string): string {
  const conocida = ETIQUETA_FUNCIONALIDAD[funcionalidad]
  if (conocida) return conocida
  const texto = funcionalidad.replace(/[-_.]+/g, ' ').trim()
  return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : 'Otra funcionalidad'
}

export function etiquetaTipo(tipo: ProcesoMasivo['tipo']): string {
  return tipo === 'exportacion' ? 'Exportación' : 'Importación'
}

export function avance(proceso: Pick<ProcesoMasivo, 'procesados' | 'total'>): string {
  return proceso.total === null ? `${proceso.procesados}` : `${proceso.procesados} de ${proceso.total}`
}

// `procesados` cuenta TODAS las filas leídas (correctas y con error): 500 filas con 20 inválidas terminan con
// procesados = 500 y con_errores = 20 (CA-IMP-01-1). Correctas = procesados - con_errores.
export function correctas(proceso: Pick<ProcesoMasivo, 'procesados' | 'con_errores'>): number {
  return Math.max(0, proceso.procesados - proceso.con_errores)
}

const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios)

// «480 correctas y 20 con error» (CA-IMP-01-1).
export function resultado(proceso: Pick<ProcesoMasivo, 'procesados' | 'con_errores'>): string {
  const ok = correctas(proceso)
  return `${ok} ${plural(ok, 'correcta', 'correctas')} y ${proceso.con_errores} con error`
}

export function porcentaje(proceso: Pick<ProcesoMasivo, 'procesados' | 'total'>): number | null {
  if (proceso.total === null || proceso.total === 0) return null
  return Math.min(100, Math.round((proceso.procesados / proceso.total) * 100))
}

export function duracion(proceso: Pick<ProcesoMasivo, 'creado_en' | 'iniciado_en' | 'finalizado_en'>): string {
  if (!proceso.finalizado_en) return proceso.iniciado_en ? 'en curso' : 'sin empezar'
  const desde = new Date(proceso.iniciado_en ?? proceso.creado_en).getTime()
  const segundos = Math.max(0, Math.round((new Date(proceso.finalizado_en).getTime() - desde) / 1000))
  if (segundos < 60) return `${segundos} s`
  const minutos = Math.floor(segundos / 60)
  if (minutos < 60) return `${minutos} min ${segundos % 60} s`
  return `${Math.floor(minutos / 60)} h ${minutos % 60} min`
}

export function formatearFecha(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
}

// Mensaje claro para el error de la base al cancelar (FR-014).
export function mensajeCancelacion(error: { message?: string } | null): string {
  const texto = error?.message ?? ''
  if (texto.includes('PROCESO_TERMINADO')) return 'El proceso ya terminó, no se puede cancelar.'
  if (texto.includes('NO_AUTORIZADO')) return 'No tenés permiso para cancelar este proceso.'
  return 'No pudimos cancelar el proceso. Probá de nuevo.'
}

// ---- Reporte de errores en CSV (RF-IMP-01-3, CA-IMP-01-3) ----

// Fila, columna y motivo de cada error (más la referencia, que ayuda a ubicar el registro). El CSV lo arma
// `armarCsv`: UTF-8 con BOM y neutralización de fórmulas (= + - @ tab CR) en todo texto.
export const COLUMNAS_CSV_ERRORES: readonly ColumnaCsv<ErrorProceso>[] = [
  { encabezado: 'Fila', valor: (error) => error.fila },
  { encabezado: 'Columna', valor: (error) => error.columna },
  { encabezado: 'Referencia', valor: (error) => error.referencia },
  { encabezado: 'Motivo', valor: (error) => error.motivo_sanitizado },
]

export const LOTE_CSV_ERRORES = 1000

// `errores-carga-de-catalogo-2026-11-07.csv`: nombre del proceso (sin caracteres raros) y día de hoy.
export function nombreArchivoErrores(nombre: string, ahora: Date = new Date()): string {
  const base = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `errores-${base || 'proceso'}-${hoyEnOrganizacion(ahora)}.csv`
}

// Un lote de errores del proceso en el orden de la tabla (todo el reporte, no solo lo visible).
export async function pedirLoteErrores(procesoId: string, desde: number, limite: number): Promise<ErrorProceso[]> {
  const { data, error } = await supabaseClient
    .from('procesos_masivos_errores')
    .select(COLUMNAS_ERROR)
    .eq('proceso_id', procesoId)
    .order('fila', { ascending: true, nullsFirst: true })
    .order('creado_en', { ascending: true })
    .range(desde, desde + limite - 1)
  if (error) throw error
  return (data ?? []) as ErrorProceso[]
}
