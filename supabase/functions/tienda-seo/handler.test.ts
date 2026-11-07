// Pruebas de `tienda-seo` (F-TDA-21, FR-023/FR-025, SC-006) con la base simulada: `robots.txt` y `sitemap.xml` de
// una tienda activa, respuesta idéntica para host desconocido / ausente / desactivada, XML escapado y errores
// genéricos. Corre con `node --test` (`pnpm test:edge:tienda-seo`); el handler no importa nada de Deno.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { manejar, sitemapVacio, type Deps } from './handler.ts'

const MAPA = {
  dominio: 'tienda-a.ejemplo.com',
  urls: [
    { ruta: '/', modificado: null },
    { ruta: '/catalogo', modificado: null },
    { ruta: '/producto/a1', modificado: '2027-01-05' },
  ],
}

function montar(opciones: { activa?: boolean; falla?: boolean; mapa?: unknown; seo?: unknown } = {}) {
  const llamadas: [string, Record<string, unknown>][] = []
  const deps: Deps = {
    rpc: async (nombre, args) => {
      llamadas.push([nombre, args])
      if (opciones.falla) return { data: null, error: { message: 'boom con datos internos' } }
      if (!(opciones.activa ?? true)) return { data: null, error: null }
      if (nombre === 'seo_tienda_por_dominio') return { data: opciones.seo ?? { dominio: MAPA.dominio }, error: null }
      return { data: opciones.mapa ?? MAPA, error: null }
    },
  }
  return { deps, llamadas }
}

const pedir = (ruta: string, host: string | null, metodo = 'GET') =>
  new Request(`https://x.supabase.co/functions/v1/tienda-seo${ruta}`, { method: metodo, headers: host === null ? {} : { 'X-Tienda-Host': host } })

describe('tienda-seo · robots.txt', () => {
  it('tienda activa: permite todo y apunta al sitemap con el dominio canónico', async () => {
    const { deps, llamadas } = montar()
    const r = await manejar(pedir('/robots.txt', 'Tienda-A.ejemplo.com:443'), deps)
    assert.equal(r.status, 200)
    assert.match(r.headers.get('content-type') ?? '', /^text\/plain/)
    assert.equal(await r.text(), 'User-agent: *\nAllow: /\nSitemap: https://tienda-a.ejemplo.com/sitemap.xml\n')
    assert.deepEqual(llamadas, [['seo_tienda_por_dominio', { host: 'Tienda-A.ejemplo.com:443' }]])
  })

  it('desactivada, desconocida y sin cabecera: la misma respuesta con Disallow: /', async () => {
    const desactivada = await manejar(pedir('/robots.txt', 'pausada.ejemplo.com'), montar({ activa: false }).deps)
    const sinHost = montar()
    const ausente = await manejar(pedir('/robots.txt', null), sinHost.deps)
    const cuerpo = 'User-agent: *\nDisallow: /\n'
    assert.equal(desactivada.status, 200)
    assert.equal(await desactivada.text(), cuerpo)
    assert.equal(await ausente.text(), cuerpo)
    assert.equal(sinHost.llamadas.length, 0, 'sin host no se consulta la base')
  })

  it('un dominio con caracteres raros que devuelva la base se trata como sin tienda', async () => {
    const r = await manejar(pedir('/robots.txt', 'a.com'), montar({ seo: { dominio: 'a.com\nSitemap: https://malo.example' } }).deps)
    assert.equal(await r.text(), 'User-agent: *\nDisallow: /\n')
  })
})

describe('tienda-seo · sitemap.xml', () => {
  it('tienda activa: lista las URLs con el dominio canónico y lastmod cuando existe', async () => {
    const { deps, llamadas } = montar()
    const r = await manejar(pedir('/sitemap.xml', 'tienda-a.ejemplo.com'), deps)
    assert.equal(r.status, 200)
    assert.match(r.headers.get('content-type') ?? '', /^application\/xml/)
    const xml = await r.text()
    assert.match(xml, /<loc>https:\/\/tienda-a\.ejemplo\.com\/<\/loc><\/url>/)
    assert.match(xml, /<loc>https:\/\/tienda-a\.ejemplo\.com\/producto\/a1<\/loc><lastmod>2027-01-05<\/lastmod>/)
    assert.equal((xml.match(/<url>/g) ?? []).length, 3)
    assert.deepEqual(llamadas, [['sitemap_por_dominio', { host: 'tienda-a.ejemplo.com' }]])
  })

  it('desactivada y desconocida: sitemap válido sin URLs, idéntico', async () => {
    const desactivada = await manejar(pedir('/sitemap.xml', 'pausada.ejemplo.com'), montar({ activa: false }).deps)
    const desconocida = await manejar(pedir('/sitemap.xml', 'nadie.ejemplo.com'), montar({ activa: false }).deps)
    assert.equal(desactivada.status, 200)
    assert.equal(await desactivada.text(), sitemapVacio())
    assert.equal(await desconocida.text(), sitemapVacio())
    assert.doesNotMatch(sitemapVacio(), /<url>/)
  })

  it('escapa los caracteres de XML en las URLs', async () => {
    const mapa = { dominio: 'tienda-a.ejemplo.com', urls: [{ ruta: '/producto/a&b<c>"d\'', modificado: 'no-es-fecha' }] }
    const xml = await (await manejar(pedir('/sitemap.xml', 'tienda-a.ejemplo.com'), montar({ mapa }).deps)).text()
    assert.match(xml, /<loc>https:\/\/tienda-a\.ejemplo\.com\/producto\/a&amp;b&lt;c&gt;&quot;d&apos;<\/loc><\/url>/)
    assert.doesNotMatch(xml, /lastmod/)
  })
})

describe('tienda-seo · errores', () => {
  it('un fallo de la base responde 500 genérico sin detalles', async () => {
    const r = await manejar(pedir('/robots.txt', 'tienda-a.ejemplo.com'), montar({ falla: true }).deps)
    assert.equal(r.status, 500)
    assert.doesNotMatch(await r.text(), /boom|internos/)
  })

  it('método distinto de GET/HEAD: 405; ruta desconocida: 404', async () => {
    const { deps } = montar()
    assert.equal((await manejar(pedir('/robots.txt', 'a.com', 'POST'), deps)).status, 405)
    assert.equal((await manejar(pedir('/otra.txt', 'a.com'), deps)).status, 404)
    assert.equal((await manejar(pedir('/robots.txt', 'a.com', 'HEAD'), deps)).status, 200)
  })
})
