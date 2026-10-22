import type { SupabaseClient } from '@supabase/supabase-js'

// Importación del historial de ventas (MSF-293, F-VTA-37/FR-002 y FR-010). La
// base repite las reglas (bucket privado, prefijo por organización, 50 MB,
// CSV/Excel): acá solo se avisa antes de subir y se traduce el error de la RPC
// a un mensaje accionable. Nunca se usa una service-role key en el navegador:
// la subida va con la sesión del administrador y las policies del bucket.
export const BUCKET_HISTORIAL = 'historial-importaciones'
export const MAX_BYTES_HISTORIAL = 50 * 1024 * 1024
export const AYUDA_PLANILLA = 'Hasta 50 MB. Formato .csv o .xlsx, con una fila por registro.'

export const TIPOS_HISTORIAL = [
  { valor: 'comprobantes', etiqueta: 'Comprobantes de venta', detalle: 'Facturas, notas y recibos: fecha, cliente e importe.' },
  { valor: 'cobros', etiqueta: 'Cobros', detalle: 'Pagos recibidos: fecha, cliente, medio e importe.' },
  { valor: 'cotizaciones', etiqueta: 'Cotizaciones del dólar', detalle: 'Valor comprador y vendedor por fecha.' },
] as const

export type TipoHistorial = (typeof TIPOS_HISTORIAL)[number]['valor']

const EXTENSIONES = ['csv', 'xlsx'] as const
type ExtensionHistorial = (typeof EXTENSIONES)[number]

const MIME_POR_EXTENSION: Readonly<Record<ExtensionHistorial, string>> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

export type RechazoHistorial = {
  fila: number
  columna: string
  motivo: string
}

export type DetalleHistorial = {
  tipo?: string
  total_filas?: number
  nuevas?: number
  existentes?: number
  total_rechazos?: number
  rechazos_truncados?: boolean
  rechazos?: RechazoHistorial[]
}

export type EstadoEjecucionHistorial = 'en_curso' | 'exitosa' | 'fallida' | 'timeout'

export type EjecucionHistorial = {
  id: string
  estado: EstadoEjecucionHistorial
  motivo_sanitizado: string | null
  detalle: DetalleHistorial
  iniciada_en: string
  finalizada_en: string | null
}

export type ClienteHistorial = Pick<SupabaseClient, 'from' | 'rpc' | 'storage'>

function extensionDe(archivo: File): ExtensionHistorial | null {
  const punto = archivo.name.lastIndexOf('.')
  if (punto < 0) return null
  const extension = archivo.name.slice(punto + 1).toLowerCase()
  return (EXTENSIONES as readonly string[]).includes(extension) ? (extension as ExtensionHistorial) : null
}

/** Mensaje para mostrar, o null si la planilla se puede subir. */
export function validarArchivoHistorial(archivo: File): string | null {
  const extension = extensionDe(archivo)
  if (!extension) {
    return `«${archivo.name}» no es un archivo .csv o .xlsx.`
  }
  if (archivo.size === 0) {
    return `«${archivo.name}» está vacío.`
  }
  if (archivo.size > MAX_BYTES_HISTORIAL) {
    return `«${archivo.name}» pesa más de 50 MB.`
  }
  return null
}

export function rutaArchivoHistorial(organizacionId: string, archivo: File): string {
  const extension = extensionDe(archivo) ?? 'csv'
  return `${organizacionId}/${crypto.randomUUID()}.${extension}`
}

const CODIGOS_SOLICITUD: Readonly<Record<string, string>> = {
  NO_AUTORIZADO: 'Tu rol no puede importar el historial de esta organización.',
  TIPO_INVALIDO: 'Elegí un tipo de importación válido.',
  ARCHIVO_INVALIDO: 'La planilla no quedó registrada. Volvé a subirla.',
  SIN_CONEXION_HISTORIAL: 'Esta organización no tiene habilitada la importación del historial. Contactá a soporte.',
  YA_EN_CURSO: 'Ya hay una importación de este tipo en curso. Esperá a que termine.',
}

export function mensajeDeErrorSolicitud(mensaje: string | null | undefined): string {
  const codigo = (mensaje ?? '').split(':')[0]?.trim().toUpperCase()
  return CODIGOS_SOLICITUD[codigo] ?? 'No pudimos iniciar la importación. Intentá de nuevo en unos minutos.'
}

export type ImportacionSolicitada = {
  ejecucionId: string
  ruta: string
}

// Sube la planilla y crea la ejecución. Si la RPC falla, borra el archivo
// recién subido: no queda un huérfano en el bucket privado.
export async function solicitarImportacionHistorial(
  cliente: ClienteHistorial,
  { organizacionId, tipo, archivo }: { organizacionId: string; tipo: TipoHistorial; archivo: File },
): Promise<ImportacionSolicitada> {
  const ruta = rutaArchivoHistorial(organizacionId, archivo)
  const extension = extensionDe(archivo) ?? 'csv'
  const bucket = cliente.storage.from(BUCKET_HISTORIAL)

  let errorSubida: unknown = null
  try {
    const { error } = await bucket.upload(ruta, archivo, {
      contentType: MIME_POR_EXTENSION[extension],
      upsert: false,
    })
    errorSubida = error
  } catch (excepcion) {
    errorSubida = excepcion
  }
  if (errorSubida) {
    console.error('No pudimos subir la planilla del historial.', errorSubida)
    throw new Error('No pudimos subir la planilla. Revisá tu conexión e intentá de nuevo.')
  }

  const { data, error } = await cliente.rpc('solicitar_importacion_historial', {
    p_tipo: tipo,
    p_archivo: ruta,
  })
  if (error) {
    // La limpieza es best effort: el mensaje que ve el usuario es el de la RPC.
    try {
      const { error: errorLimpieza } = await bucket.remove([ruta])
      if (errorLimpieza) console.error('No pudimos borrar la planilla que no se registró.', errorLimpieza)
    } catch (excepcion) {
      console.error('No pudimos borrar la planilla que no se registró.', excepcion)
    }
    throw new Error(mensajeDeErrorSolicitud(error.message))
  }

  return { ejecucionId: data as string, ruta }
}

const ESTADOS_EJECUCION: readonly EstadoEjecucionHistorial[] = ['en_curso', 'exitosa', 'fallida', 'timeout']

function esEstadoEjecucion(valor: unknown): valor is EstadoEjecucionHistorial {
  return typeof valor === 'string' && (ESTADOS_EJECUCION as readonly string[]).includes(valor)
}

function entero(valor: unknown): number | undefined {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : undefined
}

function leerRechazos(valor: unknown): RechazoHistorial[] {
  if (!Array.isArray(valor)) return []
  return valor.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const rechazo = item as Record<string, unknown>
    const fila = entero(rechazo.fila)
    if (fila === undefined || typeof rechazo.columna !== 'string' || typeof rechazo.motivo !== 'string') return []
    return [{ fila, columna: rechazo.columna, motivo: rechazo.motivo }]
  })
}

export function leerDetalle(detalle: unknown): DetalleHistorial {
  if (!detalle || typeof detalle !== 'object') return {}
  const valor = detalle as Record<string, unknown>
  return {
    tipo: typeof valor.tipo === 'string' ? valor.tipo : undefined,
    total_filas: entero(valor.total_filas),
    nuevas: entero(valor.nuevas),
    existentes: entero(valor.existentes),
    total_rechazos: entero(valor.total_rechazos),
    rechazos_truncados: typeof valor.rechazos_truncados === 'boolean' ? valor.rechazos_truncados : undefined,
    rechazos: leerRechazos(valor.rechazos),
  }
}

export async function consultarEjecucionHistorial(
  cliente: ClienteHistorial,
  organizacionId: string,
  ejecucionId: string,
): Promise<EjecucionHistorial | null> {
  const { data, error } = await cliente
    .from('ejecuciones_worker')
    .select('id, estado, motivo_sanitizado, detalle, iniciada_en, finalizada_en')
    .eq('id', ejecucionId)
    .eq('organizacion_id', organizacionId)
    .maybeSingle()
  if (error) {
    console.error('No pudimos consultar la ejecución del historial.', error)
    throw new Error('No pudimos consultar el estado de la importación.')
  }
  if (!data) return null
  const fila = data as Record<string, unknown>
  return {
    id: String(fila.id),
    estado: esEstadoEjecucion(fila.estado) ? fila.estado : 'fallida',
    motivo_sanitizado: typeof fila.motivo_sanitizado === 'string' ? fila.motivo_sanitizado : null,
    detalle: leerDetalle(fila.detalle),
    iniciada_en: String(fila.iniciada_en),
    finalizada_en: typeof fila.finalizada_en === 'string' ? fila.finalizada_en : null,
  }
}

const formatoNumero = new Intl.NumberFormat('es-AR')

export type ResumenEjecucion = {
  severidad: 'info' | 'success' | 'error'
  titulo: string
  descripcion: string
  rechazos: RechazoHistorial[]
  rechazosTruncados: boolean
  totalRechazos: number
}

export function resumenDeEjecucion(ejecucion: EjecucionHistorial): ResumenEjecucion {
  const { detalle } = ejecucion
  const rechazos = detalle.rechazos ?? []
  const totalRechazos = detalle.total_rechazos ?? rechazos.length
  const truncados = Boolean(detalle.rechazos_truncados)

  if (ejecucion.estado === 'exitosa') {
    const nuevas = detalle.nuevas ?? 0
    const existentes = detalle.existentes ?? 0
    return {
      severidad: 'success',
      titulo: 'Importación completada',
      descripcion: `Se importaron ${formatoNumero.format(nuevas)} registros nuevos. ${formatoNumero.format(existentes)} ya existían y no se duplicaron.`,
      rechazos: [],
      rechazosTruncados: false,
      totalRechazos: 0,
    }
  }

  if (ejecucion.estado === 'en_curso') {
    return {
      severidad: 'info',
      titulo: 'Importación en curso',
      descripcion: 'Estamos leyendo y validando la planilla. Podés seguir el avance en Ejecuciones.',
      rechazos: [],
      rechazosTruncados: false,
      totalRechazos: 0,
    }
  }

  if (ejecucion.estado === 'timeout') {
    return {
      severidad: 'error',
      titulo: 'La importación no terminó a tiempo',
      descripcion: 'Revisá Ejecuciones y, si no hay registros nuevos, volvé a importar la planilla.',
      rechazos: [],
      rechazosTruncados: false,
      totalRechazos: 0,
    }
  }

  return {
    severidad: 'error',
    titulo: 'La importación no se aplicó',
    descripcion: totalRechazos > 0
      ? `${formatoNumero.format(totalRechazos)} filas rechazadas. No se importó ningún registro: corregí la planilla y volvé a intentar.`
      : 'El worker rechazó la planilla. Revisá el detalle en Ejecuciones.',
    rechazos,
    rechazosTruncados: truncados,
    totalRechazos,
  }
}
