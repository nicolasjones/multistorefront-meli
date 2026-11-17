import { describe, expect, it } from 'vitest'
import {
  BUCKET_DOCUMENTOS,
  procesamientoInterrumpido,
  FORMATOS_DOCUMENTO,
  MAX_BYTES_DOCUMENTO,
  extensionDeDocumento,
  mimeDeDocumento,
  validarArchivoDocumento,
} from './documentosIa'

const archivo = (nombre: string, contenido = 'texto', tipo = 'text/plain') => new File([contenido], nombre, { type: tipo })

describe('validarArchivoDocumento', () => {
  it('acepta los formatos del bucket', () => {
    expect(validarArchivoDocumento(archivo('contrato.txt'))).toBeNull()
    expect(validarArchivoDocumento(archivo('contrato.pdf', 'pdf', 'application/pdf'))).toBeNull()
    expect(validarArchivoDocumento(archivo('contrato.docx', 'docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))).toBeNull()
  })

  it('rechaza un formato no admitido', () => {
    expect(validarArchivoDocumento(archivo('programa.exe'))).toBe(
      `«programa.exe» no es un formato admitido. Subí un archivo ${FORMATOS_DOCUMENTO}.`,
    )
    expect(validarArchivoDocumento(archivo('sin-extension'))).toContain('no es un formato admitido')
  })

  it('rechaza un archivo vacío', () => {
    expect(validarArchivoDocumento(new File([], 'vacio.txt'))).toBe('«vacio.txt» está vacío.')
  })

  it('rechaza un archivo de más de 20 MB (el mismo límite del bucket)', () => {
    const grande = { name: 'grande.txt', size: MAX_BYTES_DOCUMENTO + 1 } as File
    expect(validarArchivoDocumento(grande)).toBe('«grande.txt» pesa más de 20 MB.')
  })

  it('acepta un archivo justo en el límite', () => {
    const justo = { name: 'justo.txt', size: MAX_BYTES_DOCUMENTO } as File
    expect(validarArchivoDocumento(justo)).toBeNull()
  })
})

describe('mimeDeDocumento', () => {
  it('usa el MIME del bucket, no el que informa el navegador', () => {
    expect(mimeDeDocumento(archivo('contrato.txt', 'texto', 'application/octet-stream'))).toBe('text/plain')
    expect(mimeDeDocumento(archivo('contrato.pdf', 'pdf', 'application/octet-stream'))).toBe('application/pdf')
    expect(mimeDeDocumento(archivo('contrato.docx', 'docx', 'application/octet-stream'))).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
  })
})

describe('extensión y bucket', () => {
  it('reconoce la extensión sin distinguir mayúsculas', () => {
    expect(extensionDeDocumento(archivo('CONTRATO.PDF'))).toBe('pdf')
    expect(extensionDeDocumento(archivo('programa.exe'))).toBeNull()
  })

  it('usa el bucket de búsqueda documental', () => {
    expect(BUCKET_DOCUMENTOS).toBe('documentos-rag')
  })
})

describe('procesamientoInterrumpido', () => {
  const ahora = Date.parse('2026-06-01T12:00:00Z')
  it('solo marca como interrumpida una versión procesando de más de 15 minutos', () => {
    expect(procesamientoInterrumpido({ estado: 'procesando', subida_en: '2026-06-01T11:50:00Z' }, ahora)).toBe(false)
    expect(procesamientoInterrumpido({ estado: 'procesando', subida_en: '2026-06-01T11:40:00Z' }, ahora)).toBe(true)
    expect(procesamientoInterrumpido({ estado: 'activa', subida_en: '2026-06-01T10:00:00Z' }, ahora)).toBe(false)
    expect(procesamientoInterrumpido({ estado: 'fallida', subida_en: '2026-06-01T10:00:00Z' }, ahora)).toBe(false)
    expect(procesamientoInterrumpido({ estado: 'procesando', subida_en: 'no-es-fecha' }, ahora)).toBe(false)
  })
})
