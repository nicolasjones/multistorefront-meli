import { supabaseClient } from './supabase'
import type { Comprobante } from './ventas'

// Impresión de factura y remito (F-VTA-19, MSF-230). La autoridad es la base: `solicitar_documento_comprobante`
// valida permiso, tipo y estado, y crea el pedido que genera el worker `comprobantes-pdf` (Kestra + outbox).
// Acá solo se decide qué se ofrece, se consulta el avance y se abre el PDF con una URL firmada de corta vida.
// Contrato en docs/ventas-impresion.md.

export type TipoDocumento = 'factura' | 'remito'
export type EstadoDocumento = 'pendiente' | 'generado' | 'fallido'

export type DocumentoComprobante = {
  id: string
  comprobante_id: string
  empresa_id: string
  tipo_documento: TipoDocumento
  estado: EstadoDocumento
  ruta: string | null
  error: string | null
  solicitado_en: string
  generado_en: string | null
}

export const BUCKET_DOCUMENTOS = 'comprobantes-documentos'
// La URL firmada solo tiene que alcanzar para abrir el PDF.
export const VIGENCIA_URL_SEGUNDOS = 300
// Consulta del avance del pedido: cada 1,5 s y hasta 90 s. Pasado el tope se avisa y se ofrece «Reintentar»
// (pedir de nuevo devuelve el mismo pedido pendiente: es idempotente). La base lo cierra como fallido a los 10 min.
export const INTERVALO_CONSULTA_MS = 1500
export const TOPE_CONSULTA_MS = 90_000

export const TITULO_IMPRIMIR = 'Imprimir comprobante'
export const TEXTO_IMPRIMIR = 'Se marca como impreso con fecha y hora.'
export const MENSAJE_PREPARANDO = 'Preparando documento…'
export const MENSAJE_ENVIADO_A_IMPRIMIR = 'Enviado a imprimir'
export const MENSAJE_TARDA = 'El documento está tardando más de lo esperado. Reintentá en un momento.'
export const MENSAJE_ERROR_IMPRESION = 'No pudimos preparar el documento. Probá de nuevo.'
export const MENSAJE_NO_CONFIRMADA = 'La factura tiene que estar confirmada para imprimirla.'

export const ETIQUETA_DOCUMENTO: Readonly<Record<TipoDocumento, { etiqueta: string; subtitulo: string }>> = {
  factura: { etiqueta: 'Factura', subtitulo: 'Original para el cliente' },
  remito: { etiqueta: 'Remito', subtitulo: 'Para el armado y la entrega' },
}

// Los documentos que aplican al comprobante abierto (FR-011, FR-002): una factura confirmada ofrece factura y
// remito. El presupuesto lo suma F-VTA-20.
export function documentosElegibles(comprobante: Pick<Comprobante, 'tipo' | 'estado'>): TipoDocumento[] {
  return comprobante.tipo === 'factura' && comprobante.estado === 'confirmada' ? ['factura', 'remito'] : []
}

// Por qué no se ofrece imprimir (FR-012). Solo la factura sin confirmar tiene un motivo que mostrar.
export function motivoNoImprimible(comprobante: Pick<Comprobante, 'tipo' | 'estado'>): string | null {
  if (comprobante.tipo !== 'factura') return null
  return comprobante.estado === 'confirmada' ? null : MENSAJE_NO_CONFIRMADA
}

type ErrorDeBase = { code?: string; message?: string; hint?: string } | null

export class ErrorDocumento extends Error {}

export function esCancelacion(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

// Mensajes de la base (ya en castellano y sin nombres técnicos) o uno genérico; el detalle va a la consola.
export function mensajeDeErrorImpresion(error: unknown): string {
  if (error instanceof ErrorDocumento) return error.message
  console.error(MENSAJE_ERROR_IMPRESION, error)
  const e = error as ErrorDeBase
  if (e?.code === '42501') return 'No tenés permiso para imprimir en esta tienda. Puede que tu rol haya cambiado: recargá la página.'
  if (e?.code === 'P0002') return 'Ese comprobante no existe o no pertenece a tu organización.'
  if ((e?.code === '22023' || (e?.code === 'P0001' && e.hint === 'sin_conexion')) && e.message) return e.message
  return MENSAJE_ERROR_IMPRESION
}

function aDocumento(dato: unknown): DocumentoComprobante {
  if (typeof dato !== 'object' || dato === null) throw new Error('La base no devolvió el documento')
  return dato as DocumentoComprobante
}

export async function solicitarDocumento(comprobanteId: string, tipo: TipoDocumento): Promise<DocumentoComprobante> {
  const { data, error } = await supabaseClient.rpc('solicitar_documento_comprobante', {
    p_comprobante_id: comprobanteId,
    p_tipo_documento: tipo,
  })
  if (error) throw error
  return aDocumento(data)
}

export async function obtenerDocumento(documentoId: string): Promise<DocumentoComprobante> {
  const { data, error } = await supabaseClient.rpc('obtener_documento_comprobante', { p_documento_id: documentoId })
  if (error) throw error
  return aDocumento(data)
}

function dormir(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolver, rechazar) => {
    if (signal?.aborted) return rechazar(new DOMException('Cancelado', 'AbortError'))
    const temporizador = setTimeout(() => {
      signal?.removeEventListener('abort', alAbortar)
      resolver()
    }, ms)
    const alAbortar = () => {
      clearTimeout(temporizador)
      rechazar(new DOMException('Cancelado', 'AbortError'))
    }
    signal?.addEventListener('abort', alAbortar, { once: true })
  })
}

type OpcionesEspera = {
  intervaloMs?: number
  topeMs?: number
  signal?: AbortSignal
  // Inyectable para probar el avance sin esperar de verdad.
  esperar?: (ms: number, signal?: AbortSignal) => Promise<void>
}

// Consulta el pedido hasta que quede `generado` (lo devuelve) o `fallido` (lanza con el motivo sanitizado).
// Pasado el tope lanza «tarda más de lo esperado». Cancelable: cerrar el diálogo o cambiar de empresa aborta.
export async function esperarDocumento(documentoId: string, opciones: OpcionesEspera = {}): Promise<DocumentoComprobante> {
  const { intervaloMs = INTERVALO_CONSULTA_MS, topeMs = TOPE_CONSULTA_MS, signal, esperar = dormir } = opciones
  const consultas = Math.max(1, Math.ceil(topeMs / intervaloMs))
  for (let consulta = 1; consulta <= consultas; consulta++) {
    if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError')
    const documento = await obtenerDocumento(documentoId)
    if (documento.estado === 'generado') return documento
    if (documento.estado === 'fallido') throw new ErrorDocumento(documento.error || MENSAJE_ERROR_IMPRESION)
    if (consulta < consultas) await esperar(intervaloMs, signal)
  }
  throw new ErrorDocumento(MENSAJE_TARDA)
}

// URL firmada de corta vida del PDF (el bucket es privado; la política de lectura acota por organización,
// sección Ventas y empresa accesible).
export async function urlFirmadaDocumento(ruta: string): Promise<string> {
  const { data, error } = await supabaseClient.storage.from(BUCKET_DOCUMENTOS).createSignedUrl(ruta, VIGENCIA_URL_SEGUNDOS)
  if (error) throw error
  if (!data?.signedUrl) throw new Error('Storage no devolvió la URL del documento')
  return data.signedUrl
}
