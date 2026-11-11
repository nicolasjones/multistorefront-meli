// Exportar todos los datos (F-OPS-06, MSF-396): textos y llamadas del bloque de `/importaciones`.
// El proceso vive en el centro de procesos masivos (F-IMP-01); acá solo se pide y se descarga el ZIP.
import { supabaseClient } from './supabase'
import { COLUMNAS_PROCESO, type ProcesoMasivo } from './procesosMasivos'

export const FUNCIONALIDAD_EXPORTACION_TOTAL = 'exportacion_total'
export const COLUMNAS_EXPORTACION_TOTAL = `${COLUMNAS_PROCESO}, organizacion_id, ejecucion_id`
export const SEGUNDOS_URL_DESCARGA = 60

export type ProcesoExportacionTotal = ProcesoMasivo & { organizacion_id: string; ejecucion_id: string | null }

export class ErrorExportacionTotal extends Error {}

// Mensaje claro para el error de la base al pedir la exportación (FR-040).
export function mensajeSolicitud(error: { message?: string } | null): string {
  const texto = error?.message ?? ''
  if (texto.includes('NO_AUTORIZADO')) return 'Solo un administrador de la organización puede exportar todos los datos.'
  if (texto.includes('SIN_CONEXION_EXPORTACION')) return 'Tu organización todavía no tiene habilitado el servidor de exportaciones. Pedile ayuda a quien administra la plataforma.'
  return 'No pudimos pedir la exportación. Probá de nuevo.'
}

export async function solicitarExportacionTotal(): Promise<{ proceso_id: string; reutilizado: boolean }> {
  const { data, error } = await supabaseClient.rpc('solicitar_exportacion_total')
  if (error) throw new ErrorExportacionTotal(mensajeSolicitud(error))
  const fila = (Array.isArray(data) ? data[0] : data) as { proceso_id: string; reutilizado: boolean } | null
  if (!fila) throw new ErrorExportacionTotal(mensajeSolicitud(null))
  return fila
}

export function nombreArchivoExportacionTotal(fecha: Date = new Date()): string {
  return `exportacion-total-${fecha.toISOString().slice(0, 10)}.zip`
}

// Descarga con una URL firmada de vida corta; la política de Storage solo la deja a un administrador de la organización.
export async function descargarExportacionTotal(proceso: Pick<ProcesoExportacionTotal, 'organizacion_id' | 'ejecucion_id'>): Promise<void> {
  if (!proceso.ejecucion_id) throw new ErrorExportacionTotal('No encontramos el archivo de esta exportación.')
  const nombre = nombreArchivoExportacionTotal()
  const { data, error } = await supabaseClient.storage
    .from('exportaciones-organizacion')
    .createSignedUrl(`${proceso.organizacion_id}/${proceso.ejecucion_id}.zip`, SEGUNDOS_URL_DESCARGA, { download: nombre })
  if (error || !data?.signedUrl) throw new ErrorExportacionTotal('No pudimos preparar la descarga. Pedí la exportación de nuevo si el archivo ya no está.')
  const enlace = document.createElement('a')
  enlace.href = data.signedUrl
  enlace.download = nombre
  enlace.rel = 'noopener'
  document.body.appendChild(enlace)
  enlace.click()
  enlace.remove()
}
