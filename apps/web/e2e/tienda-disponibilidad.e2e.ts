import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

// F-TDA-18 (MSF-332, SC-009; FR-020…FR-023): con los dos dominios del seed, un producto con stock dice
// «Disponible», uno sin stock dice «Sin stock» (tarjeta del catálogo y ficha) y ninguna página muestra
// la cantidad. Requiere el stack local (`pnpm dev:supabase`, que aplica `supabase/seed.sql`) y la web
// servida; siembra con la API admin desde Node (la service-role key nunca llega al navegador). Sin
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se omite: ver docs/e2e-app.md. Dentro del test no hay
// `test.skip` dinámicos: si la tarjeta o la ficha faltaran, el test falla.
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

// Cantidades sembradas: no deben aparecer nunca en la página pública (FR-023).
const CANTIDAD_CON_STOCK = 7351

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

async function actualizar(tabla: string, filtro: string, cuerpo: unknown) {
  const r = await fetch(`${url}/rest/v1/${tabla}?${filtro}`, { method: 'PATCH', headers: cabeceras(), body: JSON.stringify(cuerpo) })
  if (!r.ok) throw new Error(`REST PATCH ${tabla}: ${r.status} ${await r.text()}`)
}

async function borrar(tabla: string, filtro: string) {
  const r = await fetch(`${url}/rest/v1/${tabla}?${filtro}`, { method: 'DELETE', headers: cabeceras() })
  if (!r.ok) console.warn(`limpieza E2E: DELETE ${tabla} → ${r.status}`)
}

// Puerto con el que se sirve el panel: los subdominios de `localhost` resuelven a loopback en Chromium.
const puerto = new URL(process.env.E2E_BASE_URL ?? `http://localhost:${Number(process.env.WEB_PORT) || 4300}`).port

test.describe('Tienda online · disponibilidad visible (SC-009)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('«Disponible» y «Sin stock» en cada tienda, sin cantidades', async ({ browser }) => {
    const sufijo = randomUUID().slice(0, 8)
    const tiendas = TIENDAS.map((t) => ({ ...t, conStock: `Con stock ${t.nombre} ${sufijo}`, sinStock: `Sin stock ${t.nombre} ${sufijo}`, categoriaId: '' }))

    try {
      for (const t of tiendas) {
        // Categoría propia: el catálogo se abre filtrado por ella, así los dos productos salen en la primera
        // tanda (de 24, ordenada por nombre) aunque la base ya tenga otros productos de la tienda.
        const [categoria] = await insertar<{ id: string }>('categorias', [{ organizacion_id: t.organizacion, nombre: `Cat ${t.nombre} ${sufijo}` }])
        t.categoriaId = categoria.id
        const [conStock, sinStock] = await insertar<{ id: string }>('productos', [
          { organizacion_id: t.organizacion, nombre: t.conStock, sku: `E2E-D-${t.empresa.slice(-1)}-${sufijo}`, precio_lista: 10, moneda: 'ARS', categoria_id: categoria.id },
          { organizacion_id: t.organizacion, nombre: t.sinStock, sku: `E2E-S-${t.empresa.slice(-1)}-${sufijo}`, precio_lista: 20, moneda: 'ARS', categoria_id: categoria.id },
        ])
        await insertar('producto_empresa', [conStock, sinStock].map((p) => ({ producto_id: p.id, empresa_id: t.empresa, organizacion_id: t.organizacion })))
        // La fila de existencias nace con el producto (trigger) en 0.
        await actualizar('existencias', `producto_id=eq.${conStock.id}`, { cantidad: CANTIDAD_CON_STOCK })
      }

      for (const t of tiendas) {
        const contexto = await browser.newContext()
        const page = await contexto.newPage()
        const base = `http://${t.host}:${puerto}`

        // Sin importar qué rutas existan, la cantidad exacta no se publica en ninguna página.
        await page.goto(`${base}/`)
        await expect(page.getByRole('heading', { level: 1, name: t.nombre })).toBeVisible()
        await expect(page.locator('body')).not.toContainText(String(CANTIDAD_CON_STOCK))

        // Tarjeta del catálogo (F-TDA-12): el listado llega por una RPC, así que se espera a que aparezca la
        // tarjeta (sin contar a ciegas ni omitir el caso si todavía no cargó: si falta, el test debe fallar).
        await page.goto(`${base}/catalogo?categoria=${t.categoriaId}`)
        const tarjetaCon = page.getByTestId('tarjeta-producto').filter({ hasText: t.conStock })
        const tarjetaSin = page.getByTestId('tarjeta-producto').filter({ hasText: t.sinStock })
        await expect(page.getByTestId('catalogo-contador')).toHaveText('2 productos')
        await expect(tarjetaCon).toHaveCount(1)
        await expect(tarjetaSin).toHaveCount(1)
        await expect(tarjetaCon).toContainText('Disponible')
        await expect(tarjetaCon).not.toContainText('Sin stock')
        await expect(tarjetaSin).toContainText('Sin stock')
        await expect(tarjetaSin).not.toContainText('Disponible')
        await expect(page.locator('body')).not.toContainText(String(CANTIDAD_CON_STOCK))

        // Ficha (F-TDA-13): la etiqueta de cada producto, sin cantidades.
        await tarjetaSin.click()
        await expect(page.getByRole('heading', { level: 1, name: t.sinStock })).toBeVisible()
        await expect(page.getByTestId('etiqueta-disponibilidad').first()).toHaveText('Sin stock')
        await expect(page.locator('body')).not.toContainText(String(CANTIDAD_CON_STOCK))
        await page.goBack()
        await tarjetaCon.click()
        await expect(page.getByRole('heading', { level: 1, name: t.conStock })).toBeVisible()
        await expect(page.getByTestId('etiqueta-disponibilidad').first()).toHaveText('Disponible')
        await expect(page.locator('body')).not.toContainText(String(CANTIDAD_CON_STOCK))
        await contexto.close()
      }
    } finally {
      // Limpieza: los productos caen en cascada con sus existencias y filas de tienda.
      for (const t of tiendas) await borrar('productos', `organizacion_id=eq.${t.organizacion}&nombre=like.*${sufijo}`)
    }
  })
})
