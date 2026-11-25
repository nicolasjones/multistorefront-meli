// Optimiza una imagen en el navegador antes de subirla: respeta la orientación EXIF, la achica a un
// lado largo máximo (sin agrandarla nunca) y la recodifica a WebP. Es degradación segura: si el
// entorno no puede decodificar o codificar, o el resultado no pesa menos, devuelve el original.
// No lee ni registra el contenido del archivo.
export const LADO_MAXIMO_PX = 1600
export const CALIDAD_WEBP = 0.82

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
