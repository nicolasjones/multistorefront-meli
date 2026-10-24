import { supabaseClient } from './supabase'
import {
  PAGINA_VACIA,
  mapearPagina,
  type FilaPagina,
  type FiltrosCatalogo,
  type PaginaCatalogo,
} from './tiendaListado'

// F-TDA-15 (MSF-413): búsqueda de la tienda pública. La coincidencia (sin tildes ni mayúsculas, con
// tolerancia a errores de tipeo), el precio final y el límite de pedidos los resuelve la base
// (migraciones 20261202110000…110200_tienda_busqueda_*.sql); acá solo se arma el pedido y se lee la respuesta.

// Constantes únicas del front. El límite por minuto vive en la base (private.limite_busquedas_por_minuto).
export const MINIMO_CARACTERES_BUSQUEDA = 2
export const MAXIMO_CARACTERES_BUSQUEDA = 100
export const ESPERA_ENTRE_TECLAS_MS = 250
export const TOPE_SUGERENCIAS = 6

// Texto del visitante → texto de búsqueda: espacios colapsados y recortado. El servidor vuelve a
// normalizar (tildes, mayúsculas) y trata el texto como literal (FR-029).
export function normalizarConsulta(texto: string | null | undefined): string {
  return (texto ?? '').replace(/\s+/g, ' ').trim().slice(0, MAXIMO_CARACTERES_BUSQUEDA)
}

export type Sugerencia = {
  id: string
  nombre: string
  precio: number | null
  disponible: boolean
  imagen: string | null
  categoriaId: string | null
}

export type RespuestaSugerencias = {
  // Segundos hasta poder volver a buscar; null si no hay límite activo.
  esperaSegundos: number | null
  sugerencias: Sugerencia[]
}

type FilaSugerencias = {
  limitado: boolean
  espera_segundos: number | null
  productos: Array<{
    id: string
    nombre: string
    precio: number | string | null
    disponible: boolean
    imagen: string | null
    categoria_id: string | null
  }>
}

// publico.sugerencias_busqueda_por_dominio es ejecutable por anon. Dominio desconocido o empresa
// desactivada devuelven null: para el front, una búsqueda sin coincidencias.
export async function leerSugerencias(host: string, q: string): Promise<RespuestaSugerencias> {
  const { data, error } = await supabaseClient.schema('publico').rpc('sugerencias_busqueda_por_dominio', { host, q })
  if (error) throw new Error(error.message)
  if (!data) return { esperaSegundos: null, sugerencias: [] }
  const fila = data as FilaSugerencias
  return {
    esperaSegundos: fila.limitado ? Math.max(1, Number(fila.espera_segundos ?? 1)) : null,
    sugerencias: fila.productos.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      precio: p.precio === null ? null : Number(p.precio),
      disponible: p.disponible,
      imagen: p.imagen,
      categoriaId: p.categoria_id,
    })),
  }
}

// publico.busqueda_pagina_por_dominio: misma forma que el catálogo (MSF-167) más el aviso de espera.
export async function leerPaginaBusqueda(host: string, q: string, filtros: FiltrosCatalogo): Promise<PaginaCatalogo> {
  const { data, error } = await supabaseClient.schema('publico').rpc('busqueda_pagina_por_dominio', {
    host,
    q,
    categoria: filtros.categoria,
    solo_con_stock: filtros.soloConStock,
    precio_max: filtros.precioMax,
    orden: filtros.orden,
    pagina: filtros.pagina,
  })
  if (error) throw new Error(error.message)
  if (!data) return PAGINA_VACIA
  const fila = data as FilaPagina & { limitado?: boolean; espera_segundos?: number | null }
  const pagina = mapearPagina(fila)
  return fila.limitado ? { ...pagina, esperaSegundos: Math.max(1, Number(fila.espera_segundos ?? 1)) } : pagina
}

// `/catalogo?q=…` desde un texto ya normalizado.
export function urlResultados(q: string): string {
  return `/catalogo?${new URLSearchParams({ q }).toString()}`
}
