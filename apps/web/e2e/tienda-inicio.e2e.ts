import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

// F-TDA-10 (MSF-399, SC-003 de la épica MSF-191): con los dos dominios del seed (mundojc.localhost y
// sanjavucho.localhost) cada home muestra solo sus categorías y destacados, con el precio de su empresa,
// y «Ver todo el catálogo →» lleva a /catalogo. Requiere el stack local (`pnpm dev:supabase`, que aplica
// `supabase/seed.sql`) y la web servida; siembra con la API admin desde Node (la service-role key nunca
// llega al navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se omite: ver docs/e2e-app.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// La service-role key escribe datos: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de tienda: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
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
  const r = await fetch(`${url}/rest/v1/${tabla}`, {
    method: 'POST',
    headers: cabeceras({ prefer: 'return=representation' }),
    body: JSON.stringify(cuerpo),
  })
  if (!r.ok) throw new Error(`REST ${tabla}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T[]
}

async function borrar(tabla: string, filtro: string) {
  const r = await fetch(`${url}/rest/v1/${tabla}?${filtro}`, { method: 'DELETE', headers: cabeceras() })
  if (!r.ok) console.warn(`limpieza E2E: DELETE ${tabla} → ${r.status}`)
}

// Puerto con el que se sirve el panel: los subdominios de `localhost` resuelven a loopback en Chromium.
const puerto = new URL(process.env.E2E_BASE_URL ?? `http://localhost:${Number(process.env.WEB_PORT) || 4300}`).port

test.describe('Tienda online · página de inicio (SC-003)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('cada home muestra solo sus categorías y destacados con el precio de su empresa', async ({ browser }) => {
    const sufijo = randomUUID().slice(0, 8)
    const tiendas = TIENDAS.map((t, i) => ({
      ...t,
      categoria: `Cat inicio ${t.nombre} ${sufijo}`,
      destacado: `Destacado ${t.nombre} ${sufijo}`,
      comun: `Comun ${t.nombre} ${sufijo}`,
      precio: 1000 * (i + 1),
      indice: i,
    }))
    const enPesos = (n: number) => `$ ${n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`

    try {
      for (const t of tiendas) {
        const [categoria] = await insertar<{ id: string }>('categorias', [{ organizacion_id: t.organizacion, nombre: t.categoria }])
        const productos = await insertar<{ id: string; nombre: string }>(
          'productos',
          [t.destacado, t.comun].map((nombre, n) => ({
            organizacion_id: t.organizacion, nombre, sku: `E2E-I-${t.indice}-${n}-${sufijo}`,
            precio_lista: t.precio, moneda: 'ARS', categoria_id: categoria.id,
          })),
        )
        await insertar('producto_empresa', productos.map((p) => ({ producto_id: p.id, empresa_id: t.empresa, organizacion_id: t.organizacion })))
        const elegido = productos.find((p) => p.nombre === t.destacado)!
        await insertar('productos_tienda', [{ empresa_id: t.empresa, producto_id: elegido.id, organizacion_id: t.organizacion, visible: true, destacado: true }])
      }

      for (const t of tiendas) {
        const otra = tiendas.find((x) => x.host !== t.host)!
        const base = `http://${t.host}:${puerto}`
        const contexto = await browser.newContext({ viewport: { width: 1440, height: 900 } })
        const page = await contexto.newPage()

        await page.goto(`${base}/`)
        await expect(page.getByRole('heading', { level: 2, name: 'Categorías' })).toBeVisible()
        await expect(page.getByRole('heading', { level: 2, name: 'Destacados' })).toBeVisible()

        // Su categoría, con «N productos», y nada de la otra tienda.
        await expect(page.getByRole('region', { name: 'Categorías' }).getByRole('link', { name: new RegExp(t.categoria) })).toContainText('2 productos')
        await expect(page.getByText(otra.categoria)).toHaveCount(0)

        // Solo el destacado de la tienda (no el producto común), con el precio de su empresa.
        await expect(page.getByRole('link', { name: new RegExp(t.destacado) })).toContainText(enPesos(t.precio))
        await expect(page.getByText(t.comun)).toHaveCount(0)
        await expect(page.getByText(otra.destacado)).toHaveCount(0)

        // «Ver todo el catálogo →» lleva a /catalogo.
        await page.getByRole('link', { name: 'Ver todo el catálogo →' }).click()
        await expect(page).toHaveURL(/\/catalogo$/)
        await expect(page.getByRole('heading', { level: 1, name: 'Todos los productos' })).toBeVisible()
        await contexto.close()
      }
    } finally {
      for (const t of tiendas) {
        await borrar('productos', `organizacion_id=eq.${t.organizacion}&sku=like.*${sufijo}`)
        await borrar('categorias', `organizacion_id=eq.${t.organizacion}&nombre=like.*${sufijo}`)
      }
    }
  })
})
