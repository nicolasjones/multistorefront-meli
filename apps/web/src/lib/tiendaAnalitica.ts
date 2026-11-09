import { supabaseClient } from './supabase'

// F-TDA-24 (MSF-315): identificadores de medición de la tienda (Google Analytics 4 y Meta Pixel), lado del panel.
// La base es la fuente de verdad de los formatos (dominio.tienda_analitica); acá se espejan para avisar bajo el
// campo antes de pedirle algo imposible a la RPC. Son identificadores públicos, no secretos.

export const PATRON_GA4 = /^G-[A-Z0-9]{4,20}$/
export const PATRON_META_PIXEL = /^[0-9]{8,20}$/

export type CampoAnalitica = 'ga4_id' | 'meta_pixel_id'

// Texto vacío = sin esa herramienta.
export type AnaliticaTienda = { ga4_id: string; meta_pixel_id: string }
export type ErroresAnalitica = Partial<Record<CampoAnalitica, string>>

export const ANALITICA_VACIA: AnaliticaTienda = { ga4_id: '', meta_pixel_id: '' }

// Igual que la RPC: recorta espacios y pasa a mayúsculas el ID de GA4.
export function normalizarAnalitica(valores: AnaliticaTienda): AnaliticaTienda {
  return { ga4_id: valores.ga4_id.trim().toUpperCase(), meta_pixel_id: valores.meta_pixel_id.trim() }
}

export function validarAnalitica(valores: AnaliticaTienda): ErroresAnalitica {
  const { ga4_id, meta_pixel_id } = normalizarAnalitica(valores)
  const errores: ErroresAnalitica = {}
  if (ga4_id !== '' && !PATRON_GA4.test(ga4_id)) {
    errores.ga4_id = 'El ID de Google Analytics 4 tiene un formato inválido. Ejemplo: G-XXXXXXXXXX.'
  }
  if (meta_pixel_id !== '' && !PATRON_META_PIXEL.test(meta_pixel_id)) {
    errores.meta_pixel_id = 'El ID de Meta Pixel tiene un formato inválido: solo números, de 8 a 20 dígitos.'
  }
  return errores
}

export function analiticaIgual(a: AnaliticaTienda, b: AnaliticaTienda): boolean {
  const x = normalizarAnalitica(a)
  const y = normalizarAnalitica(b)
  return x.ga4_id === y.ga4_id && x.meta_pixel_id === y.meta_pixel_id
}

export class ErrorGuardadoAnalitica extends Error {
  campo: CampoAnalitica | null
  // Código SQLSTATE de la base (42501 = el rol no puede editar).
  codigo: string | null
  constructor(mensaje: string, campo: string | null | undefined, codigo?: string | null) {
    super(mensaje)
    this.name = 'ErrorGuardadoAnalitica'
    this.codigo = codigo ?? null
    this.campo = campo === 'ga4_id' || campo === 'meta_pixel_id' ? campo : null
  }
}

type FilaAnalitica = { ga4_id: string | null; meta_pixel_id: string | null }

const aValores = (fila: FilaAnalitica | null): AnaliticaTienda => ({
  ga4_id: fila?.ga4_id ?? '',
  meta_pixel_id: fila?.meta_pixel_id ?? '',
})

// Lo guardado de la empresa (RLS de dominio.tienda_analitica). Sin fila = sin herramientas.
export async function leerAnalitica(empresaId: string): Promise<AnaliticaTienda> {
  const { data, error } = await supabaseClient
    .schema('dominio')
    .from('tienda_analitica')
    .select('ga4_id, meta_pixel_id')
    .eq('empresa_id', empresaId)
    .maybeSingle<FilaAnalitica>()
  if (error) throw new Error(error.message)
  return aValores(data)
}

// Un valor vacío quita esa herramienta. El `hint` del error nombra el campo.
export async function guardarAnalitica(empresaId: string, valores: AnaliticaTienda): Promise<AnaliticaTienda> {
  const { ga4_id, meta_pixel_id } = normalizarAnalitica(valores)
  const { data, error } = await supabaseClient.rpc('guardar_analitica_tienda', {
    p_empresa_id: empresaId,
    p_ga4_id: ga4_id,
    p_meta_pixel_id: meta_pixel_id,
  })
  if (error) throw new ErrorGuardadoAnalitica(error.message, (error as { hint?: string | null }).hint, (error as { code?: string | null }).code)
  return aValores(data as FilaAnalitica)
}
