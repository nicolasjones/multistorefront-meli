import { supabaseClient } from './supabase'
import type { TipoDocumento } from './ventasImpresion'

// Marca de impreso y reimpresión (F-VTA-21, MSF-256). La autoridad es la base: `registrar_impresion` valida
// permiso y que el documento esté `generado`, decide si es la primera impresión o una reimpresión y emite el evento.
// Acá solo se llaman las RPC y se arma el texto de la marca. Contrato en docs/ventas-impresion.md.

// Con F-VTA-20 los tipos de documento y los de impresión coinciden.
export type TipoDocumentoImpreso = TipoDocumento

export type ImpresionComprobante = {
  id: string
  comprobante_id: string
  empresa_id: string
  tipo_documento: TipoDocumentoImpreso
  documento_id: string
  impreso_por: string | null
  impreso_en: string
  reimpresion: boolean
}

export const ETIQUETA_MARCA: Readonly<Record<TipoDocumentoImpreso, string>> = {
  factura: 'Factura impresa',
  remito: 'Remito impreso',
  presupuesto: 'Presupuesto impreso',
}

export const MENSAJE_ERROR_MARCAS = 'No pudimos cargar las marcas de impreso.'
export const MENSAJE_ERROR_REGISTRO =
  'El documento se preparó, pero no pudimos registrar la impresión. Reintentá para marcarlo como impreso.'

const formatoMarca = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'America/Argentina/Buenos_Aires',
})

// «07/10 11:42» (hora de Buenos Aires); fecha inválida → «—».
export function formatearFechaMarca(iso: string): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return '—'
  const partes = formatoMarca.formatToParts(fecha)
  const buscar = (tipo: string) => (partes.find((parte) => parte.type === tipo)?.value ?? '').padStart(2, '0')
  return `${buscar('day')}/${buscar('month')} ${buscar('hour')}:${buscar('minute')}`
}

// «Factura impresa · 07/10 11:42», o solo «Factura impresa» si nunca se imprimió (casilla vacía).
export function textoMarca(tipo: TipoDocumentoImpreso, impresion: Pick<ImpresionComprobante, 'impreso_en'> | undefined): string {
  return impresion ? `${ETIQUETA_MARCA[tipo]} · ${formatearFechaMarca(impresion.impreso_en)}` : ETIQUETA_MARCA[tipo]
}

function aImpresion(dato: unknown): ImpresionComprobante {
  if (typeof dato !== 'object' || dato === null) throw new Error('La base no devolvió la impresión')
  return dato as ImpresionComprobante
}

export async function registrarImpresion(documentoId: string): Promise<ImpresionComprobante> {
  const { data, error } = await supabaseClient.rpc('registrar_impresion', { p_documento_id: documentoId })
  if (error) throw error
  return aImpresion(data)
}

// La última impresión de cada tipo de documento del comprobante (una fila por tipo), indexada por tipo.
export async function ultimasImpresiones(
  comprobanteId: string,
): Promise<Partial<Record<TipoDocumentoImpreso, ImpresionComprobante>>> {
  const { data, error } = await supabaseClient.rpc('ultimas_impresiones_comprobante', { p_comprobante_id: comprobanteId })
  if (error) throw error
  const filas = Array.isArray(data) ? (data as ImpresionComprobante[]) : []
  return Object.fromEntries(filas.map((fila) => [fila.tipo_documento, fila]))
}
