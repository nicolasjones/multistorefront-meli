import { supabaseClient } from './supabase'

// F-TDA-12 (FR-031, supuesto D1): el bucket `productos-imagenes` sigue privado y `anon` solo lee las
// imágenes de productos visibles de tiendas activas (private.imagen_publica). Como un <img> no manda
// cabeceras, el front pide URLs firmadas de corta vida con la clave pública. Si D1 se resuelve con URL
// pública o firmada por el servidor, se cambia SOLO este archivo.
const BUCKET = 'productos-imagenes'
const VIGENCIA_SEGUNDOS = 60 * 60

// Una sola llamada por página de tarjetas. Una ruta que no se pudo firmar (sin permiso o inexistente)
// queda sin URL: la tarjeta muestra «Sin imagen».
export async function urlsImagenesProducto(rutas: string[]): Promise<Record<string, string>> {
  const unicas = [...new Set(rutas.filter(Boolean))]
  if (unicas.length === 0) return {}
  const { data, error } = await supabaseClient.storage.from(BUCKET).createSignedUrls(unicas, VIGENCIA_SEGUNDOS)
  if (error || !data) {
    console.error('No se pudieron firmar las imágenes de la tienda', error?.message)
    return {}
  }
  const urls: Record<string, string> = {}
  for (const fila of data) {
    if (fila.path && fila.signedUrl && !fila.error) urls[fila.path] = fila.signedUrl
  }
  return urls
}

export async function urlImagenProducto(ruta: string): Promise<string | null> {
  return (await urlsImagenesProducto([ruta]))[ruta] ?? null
}
