import { randomUUID } from 'node:crypto'
import { expect, test } from './fixture'

// F-TDA-21 (MSF-279, épica MSF-149, SC-008): SEO básico con los dos dominios del seed (mundojc.localhost y
// sanjavucho.localhost): metadatos por página, canónica sin filtros, JSON-LD de la ficha, `noindex` en las
// páginas de estado y `robots.txt` / `sitemap.xml` de cada tienda y de una pausada. Los dos archivos de buscadores
// se piden a la Edge Function `tienda-seo` con `X-Tienda-Host` (lo que nginx hace en producción). Requiere el
// stack local (`pnpm dev:supabase` + `supabase functions serve`) y la web servida; siembra con la API admin desde
// Node (la service-role key nunca llega al navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se
// omite (no entra al CI público): ver docs/e2e-app.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY

// La service-role key escribe datos: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de SEO de tienda: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
}

// Ids fijos de supabase/seed.sql (MSF-241).
const TIENDAS = [
  { host: 'mundojc.localhost', organizacion: '0f5eed00-0000-4000-8000-000000000001', empresa: '0f5eed01-0000-4000-8000-000000000001', nombre: 'Mundo JC' },
  { host: 'sanjavucho.localhost', organizacion: '0f5eed00-0000-4000-8000-000000000002', empresa: '0f5eed01-0000-4000-8000-000000000002', nombre: 'San Javucho' },
] as const

const cabeceras = (extra: Record<string, string> = {}) => ({
  apikey: serviceKey ?? '',
  authorization: `Bearer ${serviceKey}`,
  'content-type': 'application/json',
  'content-profile': 'dominio',
  'accept-profile': 'dominio',
  ...extra,
})

async function insertar<T>(tabla: string, cuerpo: unknown): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${tabla}`, { method: 'POST', headers: cabeceras({ prefer: 'return=representation' }), body: JSON.stringify(cuerpo) })
  if (!r.ok) throw new Error(`REST ${tabla}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T[]
}

async function actualizar(tabla: string, filtro: string, cuerpo: unknown) {
  const r = await fetch(`${url}/rest/v1/${tabla}?${filtro}`, { method: 'PATCH', headers: cabeceras(), body: JSON.stringify(cuerpo) })
  if (!r.ok) throw new Error(`REST PATCH ${tabla}: ${r.status} ${await r.text()}`)
}

async function borrar(tabla: string, filtro: string) {
  const r = await fetch(`${url}/rest/v1/${tabla}?${filtro}`, { method: 'DELETE', headers: cabeceras() })
  if (!r.ok) console.warn(`limpieza E2E: DELETE ${tabla} → ${r.status}`)
}

const activar = (empresa: string, activa: boolean) => actualizar('empresas', `id=eq.${empresa}`, { activa })

// Lo que nginx hace en producción: pide el archivo a la Edge Function mandando el host original.
async function pedirArchivo(archivo: 'robots.txt' | 'sitemap.xml', host: string): Promise<{ estado: number; cuerpo: string }> {
  const r = await fetch(`${url}/functions/v1/tienda-seo/${archivo}`, { headers: { apikey: anonKey ?? '', 'X-Tienda-Host': host } })
  return { estado: r.status, cuerpo: await r.text() }
}

const puerto = new URL(process.env.E2E_BASE_URL ?? `http://localhost:${Number(process.env.WEB_PORT) || 4300}`).port
const direccion = (host: string, ruta = '/') => `http://${host}:${puerto}${ruta}`

test.describe('Tienda online · SEO y posicionamiento básico (F-TDA-21)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  const sufijo = randomUUID().slice(0, 8)
  const datos = TIENDAS.map((t, i) => ({ ...t, indice: i, categoria: `Cat SEO ${t.nombre} ${sufijo}`, producto: `Prod SEO ${t.nombre} ${sufijo}`, categoriaId: '', productoId: '' }))

  test.beforeAll(async () => {
    for (const t of datos) {
      const [categoria] = await insertar<{ id: string }>('categorias', { organizacion_id: t.organizacion, nombre: t.categoria })
      const [producto] = await insertar<{ id: string }>('productos', {
        organizacion_id: t.organizacion, nombre: t.producto, sku: `E2E-SEO-${t.indice}-${sufijo}`, precio_lista: 1500, moneda: 'ARS', categoria_id: categoria.id,
        descripcion: `Descripción de ${t.producto}`,
      })
      await insertar('producto_empresa', { producto_id: producto.id, empresa_id: t.empresa, organizacion_id: t.organizacion })
      t.categoriaId = categoria.id
      t.productoId = producto.id
    }
  })

  test.afterAll(async () => {
    for (const t of datos) {
      await activar(t.empresa, true)
      await borrar('productos', `organizacion_id=eq.${t.organizacion}&sku=like.*${sufijo}`)
      await borrar('categorias', `organizacion_id=eq.${t.organizacion}&nombre=like.*${sufijo}`)
    }
  })

  test('[MSF-279:T068] [F-TDA-21#SC-008] metadatos, canónica y JSON-LD por página en las dos tiendas', async ({ page }) => {
    for (const t of datos) {
      const meta = (selector: string) => page.locator(`head ${selector}`).first()
      await page.goto(direccion(t.host, `/producto/${t.productoId}?utm=1`))
      await expect(page.getByRole('heading', { level: 1, name: t.producto })).toBeVisible()
      await expect(page).toHaveTitle(new RegExp(`^${t.producto.slice(0, 20)}.*`))
      await expect(meta('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`^https://[^/]+/producto/${t.productoId}$`))
      await expect(meta('meta[property="og:type"]')).toHaveAttribute('content', 'product')
      await expect(meta('meta[name="description"]')).toHaveAttribute('content', `Descripción de ${t.producto}`)
      await expect(meta('meta[name="robots"]')).toHaveAttribute('content', 'index, follow')
      const jsonLd = JSON.parse((await page.locator('head script[type="application/ld+json"]').first().textContent()) ?? '{}')
      expect(jsonLd['@type']).toBe('Product')
      expect(jsonLd.offers.priceCurrency).toBe('ARS')
      expect(jsonLd.name).toBe(t.producto)

      await page.goto(direccion(t.host, '/'))
      await expect(page.getByRole('heading', { level: 1, name: t.nombre })).toBeVisible()
      await expect(meta('link[rel="canonical"]')).toHaveAttribute('href', /^https:\/\/[^/]+\/$/)
      expect(JSON.parse((await page.locator('head script[type="application/ld+json"]').first().textContent()) ?? '{}')['@type']).toBe('Organization')

      for (const [ruta, titulo] of [['/catalogo?orden=precio', 'Todos los productos'], [`/categoria/${t.categoriaId}`, t.categoria], ['/contacto', 'Contacto']] as const) {
        await page.goto(direccion(t.host, ruta))
        await expect(page).toHaveTitle(new RegExp(`^${titulo.slice(0, 20)}`))
        await expect(meta('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`${ruta.split('?')[0]}$`))
        await expect(meta('meta[property="og:url"]')).toHaveAttribute('content', new RegExp(`${ruta.split('?')[0]}$`))
      }
    }
  })

  test('[MSF-279:T068] [F-TDA-21#FR-024] noindex en 404, ingresar, recuperar y resultados de búsqueda', async ({ page }) => {
    const t = datos[0]
    for (const ruta of ['/ruta-que-no-existe', '/ingresar', '/recuperar-contrasena', '/catalogo?q=Prod']) {
      await page.goto(direccion(t.host, ruta))
      await expect(page.locator('head meta[name="robots"]')).toHaveAttribute('content', 'noindex')
      await expect(page.locator('head link[rel="canonical"]')).toHaveCount(0)
    }
  })

  test('[MSF-279:T068] [F-TDA-21#FR-025] «Volvemos pronto» y dominio desconocido llevan noindex', async ({ page }) => {
    const t = datos[0]
    try {
      await activar(t.empresa, false)
      await page.goto(direccion(t.host))
      await expect(page.getByRole('heading', { level: 1, name: 'Volvemos pronto' })).toBeVisible()
      await expect(page.locator('head meta[name="robots"]')).toHaveAttribute('content', 'noindex')
    } finally {
      await activar(t.empresa, true)
    }
    await page.goto(direccion('no-existe.localhost'))
    await expect(page.getByRole('heading', { level: 1, name: 'Volvemos pronto' })).toBeVisible()
    await expect(page.locator('head meta[name="robots"]')).toHaveAttribute('content', 'noindex')
  })

  test('[MSF-279:T068] [F-TDA-21#FR-023] robots.txt y sitemap.xml de cada tienda y de una pausada', async () => {
    test.skip(!anonKey, 'Requiere SUPABASE_ANON_KEY para llamar a la Edge Function.')
    const [a, b] = datos
    const robotsA = await pedirArchivo('robots.txt', a.host)
    expect(robotsA.estado).toBe(200)
    expect(robotsA.cuerpo).toContain('Allow: /')
    expect(robotsA.cuerpo).toContain(`Sitemap: https://${a.host}/sitemap.xml`)

    const mapaA = await pedirArchivo('sitemap.xml', a.host)
    expect(mapaA.cuerpo).toContain(`https://${a.host}/producto/${a.productoId}`)
    expect(mapaA.cuerpo).toContain(`https://${a.host}/categoria/${a.categoriaId}`)
    expect(mapaA.cuerpo).not.toContain(b.productoId)
    const mapaB = await pedirArchivo('sitemap.xml', b.host)
    expect(mapaB.cuerpo).toContain(`https://${b.host}/producto/${b.productoId}`)
    expect(mapaB.cuerpo).not.toContain(a.productoId)

    const desconocido = { robots: await pedirArchivo('robots.txt', 'no-existe.localhost'), mapa: await pedirArchivo('sitemap.xml', 'no-existe.localhost') }
    expect(desconocido.robots.cuerpo).toBe('User-agent: *\nDisallow: /\n')
    expect(desconocido.mapa.cuerpo).not.toContain('<url>')
    try {
      await activar(a.empresa, false)
      expect(await pedirArchivo('robots.txt', a.host)).toEqual(desconocido.robots)
      expect(await pedirArchivo('sitemap.xml', a.host)).toEqual(desconocido.mapa)
    } finally {
      await activar(a.empresa, true)
    }
    expect((await pedirArchivo('robots.txt', a.host)).cuerpo).toContain('Allow: /')
  })
})
