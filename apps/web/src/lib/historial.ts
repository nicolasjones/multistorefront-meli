// Importación del historial de ventas (F-VTA-37, FR-002/FR-003/FR-010). El contrato vive en
// supabase/migrations/20261020100200_historial_solicitar_importacion.sql y en el worker
// workers/historial-importador; acá solo se prepara la subida y se rotulan los resultados.

export type TipoHistorial = 'comprobantes' | 'cobros' | 'cotizaciones'

export const TIPOS_HISTORIAL: ReadonlyArray<{ valor: TipoHistorial; etiqueta: string }> = [
  { valor: 'comprobantes', etiqueta: 'Ventas (comprobantes)' },
  { valor: 'cobros', etiqueta: 'Cobros' },
  { valor: 'cotizaciones', etiqueta: 'Cotizaciones del dólar' },
]

export const BUCKET_HISTORIAL = 'historial-importaciones'
// Mismo tope que el bucket (file_size_limit de la migración 20261020100100).
export const TAMANO_MAXIMO_ARCHIVO = 50 * 1024 * 1024
export const MAX_RECHAZOS_VISIBLES = 20

type EstadoEjecucion = 'en_curso' | 'exitosa' | 'fallida' | 'timeout'

type RechazoImportacion = { fila: number; columna: string; motivo: string }

export type EjecucionImportacion = {
  id: string
  estado: EstadoEjecucion
  motivo_sanitizado: string | null
  detalle: {
    tipo?: string
    nuevas?: number
    existentes?: number
    total?: number
    total_rechazos?: number
    rechazos?: RechazoImportacion[]
  } | null
}

export function extensionPermitida(nombre: string): 'csv' | 'xlsx' | null {
  const extension = /\.([a-z0-9]+)$/i.exec(nombre.trim())?.[1]?.toLowerCase()
  return extension === 'csv' || extension === 'xlsx' ? extension : null
}

// Valida el archivo antes de subirlo; devuelve el motivo para mostrar o null si está bien.
export function validarArchivo(archivo: Pick<File, 'name' | 'size'>): string | null {
  if (extensionPermitida(archivo.name) === null) return 'El archivo debe ser una planilla .csv o .xlsx.'
  if (archivo.size === 0) return 'El archivo está vacío.'
  if (archivo.size > TAMANO_MAXIMO_ARCHIVO) return 'El archivo supera los 50 MB. Dividilo en partes.'
  return null
}

// Ruta `<organizacion>/<tipo>/<marca>-<nombre>.<ext>`: la carpeta de la propia organización que
// exigen la policy del bucket y la RPC. El nombre se sanea (sin rutas ni caracteres raros).
export function rutaDeSubida(organizacionId: string, tipo: TipoHistorial, nombre: string, ahora: Date = new Date()): string {
  const extension = extensionPermitida(nombre) ?? 'csv'
  const base = nombre
    .replace(/\.[^.]+$/, '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'planilla'
  const marca = ahora.toISOString().replace(/[-:.]/g, '').slice(0, 15)
  return `${organizacionId}/${tipo}/${marca}-${base}.${extension}`
}

export function mensajeDeErrorImportacion(error: unknown): string {
  const texto = (error as { message?: string } | null)?.message ?? ''
  if (texto.startsWith('YA_EN_CURSO')) return 'Ya hay una importación de ese tipo en curso. Esperá a que termine.'
  if (texto.startsWith('NO_AUTORIZADO')) return 'No tenés permiso para importar el historial.'
  if (texto.startsWith('ARCHIVO_NO_ENCONTRADO')) return 'No encontramos la planilla subida. Intentá de nuevo.'
  if (texto.startsWith('ARCHIVO_INVALIDO') || texto.startsWith('TIPO_INVALIDO')) return 'La planilla o el tipo elegido no son válidos.'
  console.error('No pudimos pedir la importación.', error)
  return 'No pudimos pedir la importación. Intentá de nuevo.'
}
