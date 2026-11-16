// Blindaje de las imágenes adjuntas (FR-103/FR-108): el navegador declara el tipo, así que acá se
// comprueban los bytes. Solo JPG, PNG y WebP de hasta 2 MB; la extensión debe coincidir con el
// contenido. Una imagen que no pasa se omite (la fila se importa igual); nunca se sirve tal cual.
import { createHash } from 'node:crypto';

export const MAX_BYTES_IMAGEN = 2 * 1024 * 1024;

export type Formato = 'jpg' | 'png' | 'webp';

export const TIPO_CONTENIDO: Record<Formato, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** Formato real según los primeros bytes, o `null` si no es una imagen admitida. */
export function detectarFormato(bytes: Uint8Array): Formato | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((valor, indice) => bytes[indice] === valor)
  ) {
    return 'png';
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

/** Formato que declara el nombre de archivo (la extensión). */
export function formatoDeNombre(nombre: string): Formato | null {
  const extension = /\.([a-z0-9]+)$/i.exec(nombre)?.[1]?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'jpg';
  if (extension === 'png') return 'png';
  if (extension === 'webp') return 'webp';
  return null;
}

/** Motivo de rechazo, o `null` si la imagen se puede adjuntar. */
export function validarImagen(nombre: string, bytes: Uint8Array): string | null {
  const declarado = formatoDeNombre(nombre);
  if (!declarado) return 'extensión no admitida';
  if (bytes.length === 0) return 'archivo vacío';
  if (bytes.length > MAX_BYTES_IMAGEN) return 'pesa más de 2 MB';
  const real = detectarFormato(bytes);
  if (!real) return 'el contenido no es JPG, PNG ni WebP';
  if (real !== declarado) return 'la extensión no coincide con el contenido';
  return null;
}

/** Ruta final, determinista por nombre: reintentar reescribe el mismo objeto y no duplica. */
export function rutaFinal(organizacionId: string, productoId: string, nombre: string, formato: Formato): string {
  const huella = createHash('sha1').update(nombre.toLowerCase()).digest('hex').slice(0, 12);
  return `${organizacionId}/${productoId}/imp-${huella}.${formato}`;
}
