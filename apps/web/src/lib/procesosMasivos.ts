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
  referencia: string | null
  motivo_sanitizado: string
}

export const TAMANO_PAGINA_PROCESOS = 20
export const TAMANO_PAGINA_ERRORES = 10
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
