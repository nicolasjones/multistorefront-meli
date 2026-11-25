// Optimiza una imagen en el navegador antes de subirla: respeta la orientación EXIF, la achica a un
// lado largo máximo (sin agrandarla nunca) y la recodifica a WebP. Es degradación segura: si el
// entorno no puede decodificar o codificar, o el resultado no pesa menos, devuelve el original.
// No lee ni registra el contenido del archivo.
export const LADO_MAXIMO_PX = 1600
export const CALIDAD_WEBP = 0.82

// Guarda contra bombas de descompresión: una imagen muy comprimida pero con dimensiones enormes
// puede tumbar la pestaña al decodificar. Se leen las dimensiones del encabezado (sin decodificar).
const MAX_PIXELES = 100_000_000
const BYTES_ENCABEZADO = 256 * 1024

export class ImagenDemasiadoGrandeError extends Error {
  constructor() {
    super('La imagen tiene demasiados píxeles.')
    this.name = 'ImagenDemasiadoGrandeError'
  }
}

// Dimensiones declaradas en el encabezado de PNG, WebP o JPEG; null si no se pueden leer.
function dimensionesDeEncabezado(b: Uint8Array): { ancho: number; alto: number } | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const texto = (desde: number, n: number) => String.fromCharCode(...b.slice(desde, desde + n))
  if (b.length >= 24 && b[0] === 0x89 && texto(1, 3) === 'PNG') return { ancho: v.getUint32(16), alto: v.getUint32(20) }
  if (b.length >= 30 && texto(0, 4) === 'RIFF' && texto(8, 4) === 'WEBP') {
    const forma = texto(12, 4)
    if (forma === 'VP8X') return { ancho: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), alto: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) }
    if (forma === 'VP8L' && b[20] === 0x2f) {
      const bits = v.getUint32(21, true)
      return { ancho: 1 + (bits & 0x3fff), alto: 1 + ((bits >> 14) & 0x3fff) }
    }
    if (forma === 'VP8 ') return { ancho: v.getUint16(26, true) & 0x3fff, alto: v.getUint16(28, true) & 0x3fff }
    return null
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    // Solo se leen los primeros BYTES_ENCABEZADO: un JPEG con más de 256 KB de metadatos (APPn) antes del
    // SOF no se detecta acá y cae en la degradación segura (solo afecta a quien sube ese archivo).
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null
      const marcador = b[i + 1]
      if (marcador === 0xff) { i += 1; continue }
      if (marcador >= 0xc0 && marcador <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marcador)) return { alto: v.getUint16(i + 5), ancho: v.getUint16(i + 7) }
      // Marcadores sin longitud (TEM, RSTn, SOI, EOI): se avanza solo los 2 bytes del marcador.
      if (marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd9)) { i += 2; continue }
      i += 2 + Math.max(2, v.getUint16(i + 2))
    }
  }
  return null
}

type Lienzo = { getContext: (tipo: '2d') => unknown; convertirABlob: () => Promise<Blob | null> }

function crearLienzo(ancho: number, alto: number): Lienzo | null {
  if (typeof OffscreenCanvas === 'function') {
    const lienzo = new OffscreenCanvas(ancho, alto)
    return {
      getContext: (tipo) => lienzo.getContext(tipo),
      convertirABlob: () => lienzo.convertToBlob({ type: 'image/webp', quality: CALIDAD_WEBP }),
    }
  }
  if (typeof document !== 'undefined') {
    const lienzo = document.createElement('canvas')
    lienzo.width = ancho
    lienzo.height = alto
    return {
      getContext: (tipo) => lienzo.getContext(tipo),
      convertirABlob: () => new Promise((resolver) => lienzo.toBlob(resolver, 'image/webp', CALIDAD_WEBP)),
    }
  }
  return null
}

// Dimensiones finales: mantiene la proporción y nunca agranda.
export function dimensionesOptimizadas(ancho: number, alto: number, lado = LADO_MAXIMO_PX): { ancho: number; alto: number } {
  const largo = Math.max(ancho, alto)
  if (largo <= lado) return { ancho, alto }
  const escala = lado / largo
  return { ancho: Math.max(1, Math.round(ancho * escala)), alto: Math.max(1, Math.round(alto * escala)) }
}

export async function optimizarImagen(archivo: File): Promise<File> {
  if (typeof createImageBitmap !== 'function') return archivo
  try {
    const dimensiones = dimensionesDeEncabezado(new Uint8Array(await archivo.slice(0, BYTES_ENCABEZADO).arrayBuffer()))
    if (dimensiones && dimensiones.ancho * dimensiones.alto > MAX_PIXELES) throw new ImagenDemasiadoGrandeError()
  } catch (error) {
    if (error instanceof ImagenDemasiadoGrandeError) throw error
    // Encabezado ilegible: se sigue con la degradación segura.
  }
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(archivo, { imageOrientation: 'from-image' })
    const { ancho, alto } = dimensionesOptimizadas(bitmap.width, bitmap.height)
    const lienzo = crearLienzo(ancho, alto)
    const contexto = lienzo?.getContext('2d') as { drawImage: (...args: unknown[]) => void } | null | undefined
    if (!lienzo || !contexto) return archivo
    contexto.drawImage(bitmap, 0, 0, ancho, alto)
    const blob = await lienzo.convertirABlob()
    // Si el navegador no soporta WebP el blob sale en otro tipo: se conserva el original.
    if (!blob || blob.type !== 'image/webp' || blob.size >= archivo.size) return archivo
    const base = archivo.name.replace(/\.[^./\\]+$/, '') || 'imagen'
    return new File([blob], `${base}.webp`, { type: 'image/webp', lastModified: archivo.lastModified })
  } catch {
    return archivo
  } finally {
    bitmap?.close?.()
  }
}
