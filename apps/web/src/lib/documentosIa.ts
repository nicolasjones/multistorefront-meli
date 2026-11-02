// Documentos IA (búsqueda documental): reglas de subida (MSF-699).
//
// El bucket `documentos-rag` (supabase/migrations/20261005000001_rag_busqueda_documental.sql)
// ya limita el tamaño (20 MB) y los MIME (txt/pdf/docx): esas mismas reglas se
// validan acá, en el navegador, ANTES de tocar la base. Si no, un archivo
// demasiado grande o de otro formato deja la fila de `documentos` creada sin
// ninguna versión (documento huérfano) y el error crudo de Storage.
//
// La extensión manda sobre el `type` que informa el navegador: el MIME se
// saca de la extensión para que Storage no rechace un `.txt` que el navegador
// reporta como `application/octet-stream`.

export const BUCKET_DOCUMENTOS = 'documentos-rag'

/** Mismo límite que el bucket (`file_size_limit = 20971520`). */
export const MAX_BYTES_DOCUMENTO = 20 * 1024 * 1024
const MAX_MB_DOCUMENTO = MAX_BYTES_DOCUMENTO / (1024 * 1024)

const EXTENSIONES = ['txt', 'pdf', 'docx'] as const
type ExtensionDocumento = (typeof EXTENSIONES)[number]

/** MIME del bucket para cada extensión admitida. */
const MIME_POR_EXTENSION: Readonly<Record<ExtensionDocumento, string>> = {
  txt: 'text/plain',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

export const FORMATOS_DOCUMENTO = '.txt, .pdf o .docx'

export function extensionDeDocumento(archivo: File): ExtensionDocumento | null {
  const punto = archivo.name.lastIndexOf('.')
  if (punto < 0) return null
  const extension = archivo.name.slice(punto + 1).toLowerCase()
  return (EXTENSIONES as readonly string[]).includes(extension) ? (extension as ExtensionDocumento) : null
}

/** Mensaje para mostrar, o null si el archivo se puede subir. */
export function validarArchivoDocumento(archivo: File): string | null {
  if (!extensionDeDocumento(archivo)) {
    return `«${archivo.name}» no es un formato admitido. Subí un archivo ${FORMATOS_DOCUMENTO}.`
  }
  if (archivo.size === 0) {
    return `«${archivo.name}» está vacío.`
  }
  if (archivo.size > MAX_BYTES_DOCUMENTO) {
    return `«${archivo.name}» pesa más de ${MAX_MB_DOCUMENTO} MB.`
  }
  return null
}

/** Content-Type con el que se sube: el del bucket para la extensión del archivo. */
export function mimeDeDocumento(archivo: File): string {
  return MIME_POR_EXTENSION[extensionDeDocumento(archivo) ?? 'txt']
}
