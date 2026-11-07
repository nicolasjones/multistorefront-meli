import { supabaseClient } from './supabase'

// F-TDA-23 (MSF-306): páginas de contenido de la tienda (texto plano). La base es la fuente de verdad de
// los límites (dominio.tienda_paginas); acá se espejan solo para avisar por campo antes de pedirle algo
// imposible a la RPC. El texto se renderiza siempre escapado (React): nunca HTML.

export const LIMITE_TITULO_PAGINA = 80
export const LIMITE_CONTENIDO_PAGINA = 10000
export const TANDA_PAGINAS = 20

export type CampoPagina = 'titulo' | 'contenido'

export type PaginaTienda = {
  id: string
  titulo: string
  slug: string
  contenido: string
  visible: boolean
}

export type PaginaPublica = { titulo: string; slug: string; contenido: string }
export type EnlacePagina = { titulo: string; slug: string }

export type ErroresPagina = Partial<Record<CampoPagina, string>>

// Largo en puntos de código (como `char_length` de la base): un emoji vale 1.
export function largoPagina(valor: string): number {
  return [...valor.trim()].length
}

export function validarPagina(valores: { titulo: string; contenido: string }): ErroresPagina {
  const errores: ErroresPagina = {}
  const titulo = largoPagina(valores.titulo)
  if (titulo === 0) errores.titulo = 'El título es obligatorio.'
  else if (titulo > LIMITE_TITULO_PAGINA) errores.titulo = `El título no puede superar los ${LIMITE_TITULO_PAGINA} caracteres.`
  if (largoPagina(valores.contenido) > LIMITE_CONTENIDO_PAGINA) {
    errores.contenido = `El contenido no puede superar los ${LIMITE_CONTENIDO_PAGINA} caracteres.`
  }
  return errores
}

export class ErrorGuardadoPagina extends Error {
  campo: CampoPagina | null
  constructor(mensaje: string, campo: string | null | undefined) {
    super(mensaje)
    this.name = 'ErrorGuardadoPagina'
    this.campo = campo === 'titulo' || campo === 'contenido' ? campo : null
  }
}

const COLUMNAS = 'id, titulo, slug, contenido, visible'

// Una tanda de páginas de la empresa para la gestión (RLS de dominio.tienda_paginas), ordenadas por título.
export async function listarPaginas(empresaId: string, desde: number, cantidad = TANDA_PAGINAS): Promise<{ filas: PaginaTienda[]; total: number }> {
  const { data, error, count } = await supabaseClient
    .schema('dominio')
    .from('tienda_paginas')
    .select(COLUMNAS, { count: 'exact' })
    .eq('empresa_id', empresaId)
    .order('titulo', { ascending: true })
    .order('id', { ascending: true })
    .range(desde, desde + cantidad - 1)
  if (error) throw new Error(error.message)
  return { filas: (data ?? []) as PaginaTienda[], total: count ?? 0 }
}

export type ValoresPagina = { titulo: string; contenido: string; visible: boolean }

// `paginaId` null crea (la base genera el slug); si no, edita. El `hint` del error nombra el campo.
export async function guardarPagina(empresaId: string, paginaId: string | null, valores: ValoresPagina): Promise<PaginaTienda> {
  const { data, error } = await supabaseClient.rpc('guardar_pagina_tienda', {
    p_empresa_id: empresaId,
    p_pagina_id: paginaId,
    p_titulo: valores.titulo,
    p_contenido: valores.contenido,
    p_visible: valores.visible,
  })
  if (error) throw new ErrorGuardadoPagina(error.message, (error as { hint?: string | null }).hint)
  return data as PaginaTienda
}

export async function eliminarPagina(empresaId: string, paginaId: string): Promise<void> {
  const { error } = await supabaseClient.rpc('eliminar_pagina_tienda', { p_empresa_id: empresaId, p_pagina_id: paginaId })
  if (error) throw new Error(error.message)
}

// publico.paginas_por_dominio es ejecutable por anon. `null` cubre host desconocido y empresa desactivada.
export async function leerEnlacesPaginas(host: string): Promise<EnlacePagina[] | null> {
  const { data, error } = await supabaseClient.schema('publico').rpc('paginas_por_dominio', { host })
  if (error) throw new Error(error.message)
  if (!data) return null
  return ((data as { paginas?: EnlacePagina[] }).paginas ?? []).map(({ titulo, slug }) => ({ titulo, slug }))
}

// `null` idéntico: host desconocido, empresa desactivada, slug inexistente, oculto o de otra empresa.
export async function leerPaginaPublica(host: string, slug: string): Promise<PaginaPublica | null> {
  const { data, error } = await supabaseClient.schema('publico').rpc('pagina_por_dominio', { host, slug })
  if (error) throw new Error(error.message)
  if (!data) return null
  const fila = data as PaginaPublica
  return { titulo: fila.titulo, slug: fila.slug, contenido: fila.contenido }
}

// Párrafos de un texto plano: la línea en blanco separa párrafos; los saltos simples se respetan en pantalla.
export function aParrafos(texto: string): string[] {
  return texto
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((parrafo) => parrafo.trim())
    .filter((parrafo) => parrafo.length > 0)
}
