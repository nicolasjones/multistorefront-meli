import { useEffect } from 'react'
import { urlPublica } from '../../../lib/tiendaIdentidad'
import {
  armarTitulo,
  LIMITE_DESCRIPCION,
  recortar,
  urlCanonica,
  useSeoTienda,
  type SeoTienda,
} from '../../../lib/tiendaSeo'
import { serializarJsonLd } from './datosEstructurados'

// Marca de los nodos que escribe este componente: es lo único que se limpia al salir de la página.
const MARCA = 'data-tienda-seo'

type Contexto = { seo: SeoTienda; url: string }

type Props = {
  // Host de la tienda. Sin host (p. ej. «Volvemos pronto») solo se admite `noindex`.
  host?: string
  // Nombre de la página para la plantilla «<página> | <empresa>»; sin él, el título es la empresa.
  pagina?: string
  // Descripción de la página; sin ella, la de la tienda.
  descripcion?: string | null
  // URL absoluta de la imagen para Open Graph.
  imagen?: string | null
  // Ruta de la página (sin filtros): da la URL canónica.
  ruta?: string
  tipo?: 'website' | 'product'
  // Páginas que no deben indexarse (FR-024): solo `<title>` y `robots`, sin leer la base.
  noindex?: boolean
  // Punto de extensión de MSF-133 («no indexar» de borrador y vista previa).
  indexable?: boolean
  // JSON-LD de la página (FR-022), armado con los datos de la tienda.
  datosEstructurados?: (contexto: Contexto) => object[]
}

function agregar(etiqueta: 'meta' | 'link' | 'script', atributos: Record<string, string>, texto?: string): HTMLElement {
  const nodo = document.createElement(etiqueta)
  nodo.setAttribute(MARCA, '')
  for (const [clave, valor] of Object.entries(atributos)) nodo.setAttribute(clave, valor)
  if (texto !== undefined) nodo.textContent = texto
  document.head.appendChild(nodo)
  return nodo
}

// Metadatos por página (FR-021, FR-024): `<title>`, descripción, canónica, Open Graph y `robots`. Se escriben al
// montar y se quitan al salir, así una página nunca hereda los de la anterior. No pinta nada.
export function CabeceraSeo({ host, pagina, descripcion, imagen, ruta = '/', tipo = 'website', noindex = false, indexable = true, datosEstructurados }: Props) {
  const seo = useSeoTienda(noindex ? undefined : host)
  const robotsCerrado = noindex || !indexable || (seo !== null && !seo.indexable)
  const url = seo ? urlCanonica(seo.dominio, ruta) : null
  const titulo = noindex ? (pagina ?? null) : seo ? armarTitulo(pagina, seo.nombre) : null
  const texto = seo ? recortar(descripcion?.trim() ? descripcion : seo.descripcion, LIMITE_DESCRIPCION) : null
  const imagenOg = imagen ?? (seo ? urlPublica(seo.logoRuta) : null)
  const jsonLd = seo && url && !robotsCerrado && datosEstructurados ? datosEstructurados({ seo, url }).map(serializarJsonLd) : []
  const claveJsonLd = JSON.stringify(jsonLd)

  useEffect(() => {
    if (noindex || !indexable) {
      const nodo = agregar('meta', { name: 'robots', content: 'noindex' })
      const anterior = document.title
      if (titulo) document.title = titulo
      return () => { nodo.remove(); document.title = anterior }
    }
    if (!seo || !url || titulo === null || texto === null) return undefined

    const anterior = document.title
    document.title = titulo
    const nodos = [
      agregar('meta', { name: 'description', content: texto }),
      agregar('link', { rel: 'canonical', href: url }),
      agregar('meta', { property: 'og:title', content: titulo }),
      agregar('meta', { property: 'og:description', content: texto }),
      agregar('meta', { property: 'og:type', content: tipo }),
      agregar('meta', { property: 'og:url', content: url }),
      agregar('meta', { name: 'robots', content: seo.indexable ? 'index, follow' : 'noindex' }),
    ]
    if (imagenOg) nodos.push(agregar('meta', { property: 'og:image', content: imagenOg }))
    for (const json of JSON.parse(claveJsonLd) as string[]) nodos.push(agregar('script', { type: 'application/ld+json' }, json))
    return () => { nodos.forEach((n) => n.remove()); document.title = anterior }
  }, [noindex, indexable, seo, url, titulo, texto, tipo, imagenOg, claveJsonLd])

  return null
}
