import { useEffect, useState } from 'react'
import { supabaseClient } from './supabase'

// F-TDA-21 (MSF-279): datos para buscadores de la tienda pública. Qué dominio es el canónico, el nombre, la
// descripción por defecto y el logo los decide la base (migración 20270212100004_tienda_seo.sql); acá solo se
// lee y se recorta lo que va a `<title>` y `<meta description>`.

export type SeoTienda = {
  // Dominio canónico (dominio.tiendas.dominio), sin esquema.
  dominio: string
  nombre: string
  descripcion: string
  logoRuta: string | null
  // Punto de extensión del «no indexar» de borrador y vista previa (MSF-133). Hoy la base devuelve siempre true.
  indexable: boolean
}

type FilaSeo = { dominio: string; nombre: string; descripcion: string; logo_ruta: string | null; indexable: boolean }

export const LIMITE_TITULO = 60
export const LIMITE_DESCRIPCION = 160

// Junta los espacios y recorta con «…» para no pasar `max` caracteres. Tolera un texto ausente (`null`/`undefined`):
// una cabecera de SEO nunca debe tumbar la página de un producto por un dato que falta.
export function recortar(texto: string | null | undefined, max: number): string {
  const limpio = (texto ?? '').replace(/\s+/g, ' ').trim()
  if (limpio.length <= max) return limpio
  return `${limpio.slice(0, max - 1).trimEnd()}…`
}

// Plantilla «<página> | <empresa>» (FR-021); sin página, solo la empresa.
export function armarTitulo(pagina: string | null | undefined, empresa: string): string {
  const base = pagina?.trim() ? `${pagina.trim()} | ${empresa}` : empresa
  return recortar(base, LIMITE_TITULO)
}

// Ruta canónica: sin parámetros de filtro ni ancla y sin «/» final (salvo la raíz).
export function rutaCanonica(ruta: string): string {
  const sinQuery = ruta.split(/[?#]/)[0] ?? '/'
  const conBarra = sinQuery.startsWith('/') ? sinQuery : `/${sinQuery}`
  return conBarra.length > 1 ? conBarra.replace(/\/+$/, '') || '/' : '/'
}

export const urlCanonica = (dominio: string, ruta: string) => `https://${dominio}${rutaCanonica(ruta)}`

// publico.seo_tienda_por_dominio es ejecutable por anon. `null` (host desconocido o empresa desactivada) no
// escribe metadatos.
export async function leerSeoTienda(host: string): Promise<SeoTienda | null> {
  const { data, error } = await supabaseClient.schema('publico').rpc('seo_tienda_por_dominio', { host })
  if (error) throw new Error(error.message)
  if (!data) return null
  const fila = data as FilaSeo
  return { dominio: fila.dominio, nombre: fila.nombre, descripcion: fila.descripcion, logoRuta: fila.logo_ruta, indexable: fila.indexable !== false }
}

// Una sola lectura por host mientras viva la pestaña: cada página monta su `CabeceraSeo` y no hace falta volver
// a la base. Un fallo no se guarda, así la próxima página reintenta.
const lecturas = new Map<string, Promise<SeoTienda | null>>()

export function seoDeTienda(host: string): Promise<SeoTienda | null> {
  let lectura = lecturas.get(host)
  if (!lectura) {
    lectura = leerSeoTienda(host)
    lecturas.set(host, lectura)
    lectura.catch(() => lecturas.delete(host))
  }
  return lectura
}

export const limpiarCacheSeo = () => lecturas.clear()

// Datos SEO de la tienda del host, o `null` mientras cargan, si el host no es una tienda o si la lectura falla.
// Al cambiar de host no se devuelve el de antes.
export function useSeoTienda(host: string | undefined): SeoTienda | null {
  const [resultado, setResultado] = useState<{ host: string; seo: SeoTienda | null } | null>(null)

  useEffect(() => {
    if (!host) return undefined
    let cancelada = false
    seoDeTienda(host)
      .then((seo) => { if (!cancelada) setResultado({ host, seo }) })
      .catch((error: unknown) => {
        console.error('No se pudieron cargar los datos SEO de la tienda', error instanceof Error ? error.message : error)
        if (!cancelada) setResultado({ host, seo: null })
      })
    return () => { cancelada = true }
  }, [host])

  return host && resultado?.host === host ? resultado.seo : null
}
