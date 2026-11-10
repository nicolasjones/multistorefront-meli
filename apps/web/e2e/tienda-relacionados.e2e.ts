import { randomUUID } from 'node:crypto'
import { abrirContextoGrabado, cerrarContextoGrabado, expect, test } from './fixture'

// F-TDA-20 (MSF-263, SC-005): con los dos dominios del seed (mundojc.localhost y sanjavucho.localhost) la
// ficha muestra «Productos relacionados» (misma categoría, sin el actual, solo de la tienda) y los omite sin
// relacionados; 2 / 4 columnas en 320 / 768 / 1440 px. Requiere el stack local (`pnpm dev:supabase`, que aplica
// `supabase/seed.sql`) y la web servida; siembra con la API admin desde Node (la service-role key nunca
// llega al navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se omite (no entra al CI
// público): ver docs/e2e-app.md.
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

test.describe('Tienda online · productos relacionados (SC-005)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-263:T025] relacionados de la misma categoría y solo de la tienda, enlace a la ficha, ausencia sin relacionados y 2 / 4 columnas', async ({ browser }, testInfo) => {
    const sufijo = randomUUID().slice(0, 8)
    const tiendas = TIENDAS.map((t, i) => ({
      ...t,
      indice: i,
      categoria: `Cat ${t.nombre} ${sufijo}`,
      solitaria: `Solitaria ${t.nombre} ${sufijo}`,
      nombres: [1, 2, 3, 4, 5].map((n) => `Rel ${n} ${t.nombre} ${sufijo}`),
      ids: [] as string[],
      solitariaId: '',
    }))

    try {
      for (const t of tiendas) {
        const [categoria, otra] = await insertar<{ id: string }>('categorias', [
          { organizacion_id: t.organizacion, nombre: t.categoria },
          { organizacion_id: t.organizacion, nombre: `Otra ${t.nombre} ${sufijo}` },
        ])
        // 5 productos de la misma categoría (el actual + 4 relacionados) y uno solo en otra categoría.
        const filas = await insertar<{ id: string }>('productos', [
          ...t.nombres.map((nombre, n) => ({
            organizacion_id: t.organizacion, nombre, sku: `E2E-R-${t.indice}-${n}-${sufijo}`, precio_lista: 1000 * (n + 1), moneda: 'ARS', categoria_id: categoria.id,
          })),
          { organizacion_id: t.organizacion, nombre: t.solitaria, sku: `E2E-R-${t.indice}-S-${sufijo}`, precio_lista: 500, moneda: 'ARS', categoria_id: otra.id },
        ])
        t.ids = filas.slice(0, 5).map((f) => f.id)
        t.solitariaId = filas[5].id
        await insertar('producto_empresa', filas.map((p) => ({ producto_id: p.id, empresa_id: t.empresa, organizacion_id: t.organizacion })))
      }

      for (const t of tiendas) {
        const otra = tiendas.find((x) => x.host !== t.host)!
        const base = `http://${t.host}:${puerto}`
        const { contexto, page } = await abrirContextoGrabado(browser, testInfo, t.host)

        // Ficha del primero: los otros 4 de su categoría, nunca el actual ni los de la otra tienda.
        await page.goto(`${base}/producto/${t.ids[0]}`)
        await expect(page.getByRole('heading', { level: 1, name: t.nombres[0] })).toBeVisible()
        const seccion = page.getByRole('region', { name: 'Productos relacionados' })
        await expect(seccion).toBeVisible()
        const tarjetas = seccion.getByTestId('tarjeta-producto')
        await expect(tarjetas).toHaveCount(4)
        await expect(seccion.getByText(t.nombres[0])).toHaveCount(0)
        await expect(seccion.getByText(t.solitaria)).toHaveCount(0)
        await expect(page.getByText(otra.nombres[1])).toHaveCount(0)
        await expect(seccion.getByText('Sin imagen').first()).toBeVisible()

        // 2 columnas en celular, 4 en escritorio (320 / 768 / 1440).
        const columnas = async () => tarjetas.evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().left))).size)
        await page.setViewportSize({ width: 320, height: 800 })
        expect(await columnas()).toBe(2)
        await page.setViewportSize({ width: 768, height: 900 })
        expect(await columnas()).toBe(4)
        await page.setViewportSize({ width: 1440, height: 900 })
        expect(await columnas()).toBe(4)

        // La tarjeta enlaza a la ficha del relacionado.
        await seccion.getByRole('link', { name: new RegExp(t.nombres[1]) }).click()
        await expect(page).toHaveURL(`${base}/producto/${t.ids[1]}`)
        await expect(page.getByRole('heading', { level: 1, name: t.nombres[1] })).toBeVisible()

        // Sin relacionados: ni título ni hueco.
        await page.goto(`${base}/producto/${t.solitariaId}`)
        await expect(page.getByRole('heading', { level: 1, name: t.solitaria })).toBeVisible()
        await expect(page.getByText('Productos relacionados')).toHaveCount(0)
        await cerrarContextoGrabado(contexto, page, testInfo)
      }
    } finally {
      for (const t of tiendas) {
        await borrar('productos', `organizacion_id=eq.${t.organizacion}&sku=like.*${sufijo}`)
        await borrar('categorias', `organizacion_id=eq.${t.organizacion}&nombre=like.*${sufijo}`)
      }
    }
  })
})
