import { supabaseClient } from './supabase'

// Fotos y adjuntos del equipo (F-SVC-20). El archivo se sube al bucket privado `reparacion-adjuntos` y luego se
// registra por RPC; quitar es RPC (borra la fila y devuelve la ruta) y después borrado del objeto. La base es la
// autoridad (bucket + RPC); acá se valida solo para avisar antes de subir (FR-003).

export const BUCKET_ADJUNTOS = 'reparacion-adjuntos'
export const MAX_ADJUNTOS = 20
export const MAX_BYTES_ADJUNTO = 5 * 1024 * 1024
export const VIGENCIA_URL_SEGUNDOS = 5 * 60
export const TIPOS_ADJUNTO = ['image/jpeg', 'image/png', 'image/webp'] as const
export const ACEPTA_ADJUNTOS = 'image/jpeg,image/png,image/webp'

export type TipoAdjunto = (typeof TIPOS_ADJUNTO)[number]

export type Adjunto = {
  id: string
  ruta: string
  nombre_original: string
  mime: TipoAdjunto
  bytes: number
  creado_en: string
  subido_por: string
}

type ErrorDeBase = { code?: string; message?: string } | null | undefined

const EXTENSION_POR_TIPO: Record<TipoAdjunto, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const EXTENSION_VALIDA: Record<string, TipoAdjunto> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
}

export const MENSAJE_TIPO = 'solo se admiten imágenes JPG, PNG o WebP.'

function leerCabecera(archivo: Blob): Promise<Uint8Array> {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader()
    lector.onerror = () => rechazar(lector.error ?? new Error('No se pudo leer el archivo'))
    lector.onload = () => resolver(new Uint8Array(lector.result as ArrayBuffer))
    lector.readAsArrayBuffer(archivo.slice(0, 12))
  })
}

// Tipo real según los primeros bytes (no confiar en la extensión ni en `file.type`).
export function tipoPorCabecera(b: Uint8Array): TipoAdjunto | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return 'image/png'
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
      && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return 'image/webp'
  }
  return null
}

export type ResultadoValidacion = { ok: true; mime: TipoAdjunto } | { ok: false; mensaje: string }

// Un mensaje por archivo rechazado, con su nombre (FR-003).
export async function validarArchivoAdjunto(archivo: File): Promise<ResultadoValidacion> {
  const extension = archivo.name.includes('.') ? archivo.name.split('.').pop()!.toLowerCase() : ''
  if (!(extension in EXTENSION_VALIDA)) return { ok: false, mensaje: `«${archivo.name}»: ${MENSAJE_TIPO}` }
  if (archivo.size > MAX_BYTES_ADJUNTO) return { ok: false, mensaje: `«${archivo.name}»: pesa más de 5 MB.` }
  if (archivo.size === 0) return { ok: false, mensaje: `«${archivo.name}»: el archivo está vacío.` }
  let real: TipoAdjunto | null
  try {
    real = tipoPorCabecera(await leerCabecera(archivo))
  } catch {
    return { ok: false, mensaje: `«${archivo.name}»: no pudimos leer el archivo.` }
  }
  if (!real || EXTENSION_VALIDA[extension] !== real) return { ok: false, mensaje: `«${archivo.name}»: ${MENSAJE_TIPO}` }
  return { ok: true, mime: real }
}

export function rutaAdjunto(organizacionId: string, reparacionId: string, mime: TipoAdjunto): string {
  return `${organizacionId}/${reparacionId}/${crypto.randomUUID()}.${EXTENSION_POR_TIPO[mime]}`
}

export function mensajeDeErrorAdjunto(error: unknown, porDefecto: string): string {
  console.error(porDefecto, error)
  const e = error as ErrorDeBase
  if (e?.code === '42501') return 'No tenés permiso para modificar las fotos. Puede que tu rol haya cambiado: recargá la página.'
  if (e?.code === '55000') return 'La reparación está anulada: las fotos son de solo lectura.'
  if (e?.code === 'P0002') return 'Esa reparación o esa foto ya no existe. Recargá la página.'
  if (e?.code === '22023' && e.message) return e.message
  return porDefecto
}

export async function listarAdjuntos(reparacionId: string): Promise<Adjunto[]> {
  const { data, error } = await supabaseClient.rpc('listar_adjuntos_reparacion', { p_reparacion: reparacionId })
  if (error) throw error
  return (data ?? []) as Adjunto[]
}

// Sube el archivo ya validado y lo registra. Si el registro falla, borra el objeto recién subido para no dejar huérfanos.
export async function subirAdjunto(
  organizacionId: string,
  reparacionId: string,
  archivo: File,
  mime: TipoAdjunto,
): Promise<void> {
  const ruta = rutaAdjunto(organizacionId, reparacionId, mime)
  const subida = await supabaseClient.storage.from(BUCKET_ADJUNTOS).upload(ruta, archivo, { contentType: mime, upsert: false })
  if (subida.error) throw subida.error
  const { error } = await supabaseClient.rpc('registrar_adjunto_reparacion', {
    p_reparacion: reparacionId,
    p_ruta: ruta,
    p_nombre: archivo.name.slice(0, 200),
    p_mime: mime,
    p_bytes: archivo.size,
  })
  if (error) {
    await supabaseClient.storage.from(BUCKET_ADJUNTOS).remove([ruta]).catch(() => undefined)
    throw error
  }
}

// RPC primero (la fila deja de existir) y luego el objeto: si el borrado falla queda un archivo huérfano pero
// inaccesible desde la interfaz (docs/service-adjuntos.md).
export async function quitarAdjunto(adjuntoId: string): Promise<void> {
  const { data, error } = await supabaseClient.rpc('quitar_adjunto_reparacion', { p_adjunto: adjuntoId })
  if (error) throw error
  const ruta = (data as { ruta?: string } | null)?.ruta
  if (!ruta) return
  const { error: errorBorrado } = await supabaseClient.storage.from(BUCKET_ADJUNTOS).remove([ruta])
  if (errorBorrado) console.error('No se pudo borrar el archivo del adjunto quitado', errorBorrado.message)
}

// Una sola llamada por listado (miniaturas); las rutas que no se pueden firmar quedan sin URL.
export async function urlsAdjuntos(rutas: string[]): Promise<Record<string, string>> {
  const unicas = [...new Set(rutas.filter(Boolean))]
  if (unicas.length === 0) return {}
  const { data, error } = await supabaseClient.storage.from(BUCKET_ADJUNTOS).createSignedUrls(unicas, VIGENCIA_URL_SEGUNDOS)
  if (error || !data) {
    console.error('No se pudieron firmar las fotos de la reparación', error?.message)
    return {}
  }
  const urls: Record<string, string> = {}
  for (const fila of data) {
    if (fila.path && fila.signedUrl && !fila.error) urls[fila.path] = fila.signedUrl
  }
  return urls
}
