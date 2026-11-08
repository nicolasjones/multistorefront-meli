// Lógica de `tienda-seo` (F-TDA-21, FR-023/FR-025, SC-006) con dependencias inyectadas para poder probarla sin Deno
// ni Supabase (handler.test.ts). `index.ts` solo cablea el cliente real.
//
// Sirve `robots.txt` y `sitemap.xml` de la tienda dueña del dominio. nginx de `apps/web` proxea `/robots.txt` y
// `/sitemap.xml` acá y manda el host original en `X-Tienda-Host`. Es anónima (`verify_jwt = false`) y solo lee
// `publico.seo_tienda_por_dominio` / `publico.sitemap_por_dominio`, que ya son públicas.
//
// Host desconocido, inválido, ausente o tienda desactivada: MISMA respuesta (`robots.txt` con `Disallow: /` y sitemap
// válido sin URLs). Nunca un 404 distinto ni un mensaje que revele si el dominio existe. Un fallo de la base responde
// 500 genérico y solo se registra en el log.

type DbError = { message: string; code?: string }
type Resultado<T = unknown> = Promise<{ data: T; error: DbError | null }>

export type Deps = {
  // Solo `seo_tienda_por_dominio` y `sitemap_por_dominio` (esquema `publico`, ejecutables por anon).
  rpc(nombre: string, args: Record<string, unknown>): Resultado<unknown>
}

export type UrlSitemap = { ruta: string; modificado: string | null }

const CACHE = 'public, max-age=300'
const HOST_MAXIMO = 255
// Un dominio canónico válido; cualquier otra cosa que devuelva la base se trata como «sin tienda».
const DOMINIO = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/
const FECHA = /^\d{4}-\d{2}-\d{2}$/
const RUTA_MAXIMA = 2048
// Caracteres de control (C0, DEL y C1): nunca van en una ruta del sitemap.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

// Ruta relativa al dominio: empieza con una sola «/» (`//host` sería una URL de otro sitio), sin caracteres de
// control ni espacios, de largo acotado.
export const rutaValida = (ruta: unknown): ruta is string =>
  typeof ruta === 'string' && ruta.length <= RUTA_MAXIMA && ruta.startsWith('/') && !ruta.startsWith('//') && !CONTROL.test(ruta) && !/\s/.test(ruta)

// La respuesta depende del host (`X-Tienda-Host`) y la URL del proxy es la misma para todas las tiendas: `Vary`
// evita que un gateway/CDN que cachee por URL sirva el robots/sitemap de una tienda a otra (mezcla de tenants).
const respuesta = (cuerpo: string, tipo: string, estado = 200) =>
  new Response(cuerpo, {
    status: estado,
    headers: { 'Content-Type': `${tipo}; charset=utf-8`, 'Cache-Control': CACHE, Vary: 'X-Tienda-Host' },
  })

export function escaparXml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export const robotsCerrado = () => 'User-agent: *\nDisallow: /\n'
export const robotsAbierto = (dominio: string) => `User-agent: *\nAllow: /\nSitemap: https://${dominio}/sitemap.xml\n`

const CABECERA_XML = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
export const sitemapVacio = () => `${CABECERA_XML}\n</urlset>\n`

export function sitemapDe(dominio: string, urls: UrlSitemap[]): string {
  const filas = urls.map((u) => {
    const loc = `<loc>${escaparXml(`https://${dominio}${u.ruta}`)}</loc>`
    const mod = u.modificado && FECHA.test(u.modificado) ? `<lastmod>${u.modificado}</lastmod>` : ''
    return `  <url>${loc}${mod}</url>`
  })
  return `${CABECERA_XML}\n${filas.join('\n')}${filas.length ? '\n' : ''}</urlset>\n`
}

const dominioValido = (d: unknown): d is string => typeof d === 'string' && d.length <= HOST_MAXIMO && DOMINIO.test(d)

export async function manejar(req: Request, { rpc }: Deps): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Método no soportado.', { status: 405, headers: { Allow: 'GET, HEAD' } })
  }
  const ruta = new URL(req.url).pathname
  const esRobots = ruta.endsWith('/robots.txt')
  const esSitemap = ruta.endsWith('/sitemap.xml')
  if (!esRobots && !esSitemap) return new Response('No encontrado.', { status: 404 })

  const host = (req.headers.get('x-tienda-host') ?? '').trim()
  const consultable = host !== '' && host.length <= HOST_MAXIMO

  try {
    if (esRobots) {
      const { data, error } = consultable ? await rpc('seo_tienda_por_dominio', { host }) : { data: null, error: null }
      if (error) throw new Error(error.message)
      const dominio = (data as { dominio?: unknown } | null)?.dominio
      return respuesta(dominioValido(dominio) ? robotsAbierto(dominio) : robotsCerrado(), 'text/plain')
    }
    const { data, error } = consultable ? await rpc('sitemap_por_dominio', { host }) : { data: null, error: null }
    if (error) throw new Error(error.message)
    const mapa = data as { dominio?: unknown; urls?: unknown } | null
    if (!mapa || !dominioValido(mapa.dominio) || !Array.isArray(mapa.urls)) return respuesta(sitemapVacio(), 'application/xml')
    // El tope de 50.000 URLs corta primero productos (categorías y páginas tienen prioridad): se avisa en el log.
    if ((mapa as { truncado?: unknown }).truncado === true) console.warn(`tienda-seo: sitemap de ${mapa.dominio} truncado al tope de URLs`)
    const urls = (mapa.urls as UrlSitemap[]).filter((u) => rutaValida(u?.ruta))
    return respuesta(sitemapDe(mapa.dominio, urls), 'application/xml')
  } catch (cause) {
    console.error('tienda-seo: no se pudo leer la tienda', cause instanceof Error ? cause.message : cause)
    return new Response('No disponible.', { status: 500 })
  }
}
