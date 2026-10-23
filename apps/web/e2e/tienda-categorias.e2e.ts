import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

// F-TDA-11 (MSF-386, SC-003 de la épica MSF-167): con los dos dominios del seed (mundojc.localhost y
// sanjavucho.localhost) el menú de cada tienda lista solo sus categorías y una categoría oculta o de
// la otra tienda muestra la 404 amable. Requiere el stack local (`pnpm dev:supabase`, que aplica `supabase/seed.sql`) y la web
// servida; siembra las categorías con la API admin desde Node (la
// service-role key nunca llega al navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el
// archivo se omite (no entra al CI público): ver docs/e2e-app.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// La service-role key escribe datos: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de tienda: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
}

// Ids fijos de supabase/seed.sql (MSF-241).
const TIENDAS = [
  {
    host: 'mundojc.localhost',
    organizacion: '0f5eed00-0000-4000-8000-000000000001',
    empresa: '0f5eed01-0000-4000-8000-000000000001',
    nombre: 'Mundo JC',
  },
  {
    host: 'sanjavucho.localhost',
    organizacion: '0f5eed00-0000-4000-8000-000000000002',
    empresa: '0f5eed01-0000-4000-8000-000000000002',
    nombre: 'San Javucho',
  },
] as const

const cabeceras = (extra: Record<string, string> = {}) => ({
  apikey: serviceKey ?? '',
  authorization: `Bearer ${serviceKey}`,
  'content-type': 'application/json',
  'content-profile': 'dominio',
  'accept-profile': 'dominio',
  ...extra,
})

async function insertar<T>(tabla: string, cuerpo: unknown, upsert?: string): Promise<T[]> {
  const consulta = upsert ? `?on_conflict=${upsert}` : ''
  const r = await fetch(`${url}/rest/v1/${tabla}${consulta}`, {
    method: 'POST',
    headers: cabeceras({ prefer: `return=representation${upsert ? ',resolution=merge-duplicates' : ''}` }),
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

test.describe('Tienda online · navegación por categorías (SC-003)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('el menú de cada tienda lista solo sus categorías y la oculta o ajena da 404', async ({ browser }) => {
    const sufijo = randomUUID().slice(0, 8)
    const tiendas = TIENDAS.map((t) => ({
      ...t,
      propia: `Propia ${t.nombre} ${sufijo}`,
      oculta: `Oculta ${t.nombre} ${sufijo}`,
      propiaId: '',
      ocultaId: '',
    }))

    try {
      for (const t of tiendas) {
        const [propia, oculta] = await insertar<{ id: string }>('categorias', [
          { organizacion_id: t.organizacion, nombre: t.propia },
          { organizacion_id: t.organizacion, nombre: t.oculta },
        ])
        t.propiaId = propia.id
        t.ocultaId = oculta.id
        await insertar('categorias_tienda', { empresa_id: t.empresa, categoria_id: oculta.id, organizacion_id: t.organizacion, visible: false })
      }

      for (const t of tiendas) {
        const otra = tiendas.find((x) => x.host !== t.host)!
        const contexto = await browser.newContext()
        const page = await contexto.newPage()
        await page.goto(`http://${t.host}:${puerto}/`)

        const menu = page.getByRole('navigation', { name: 'Categorías' })
        await expect(menu.getByRole('link', { name: 'Inicio' })).toBeVisible()
        await expect(menu.getByRole('link', { name: t.propia })).toBeVisible()
        // Nada de lo oculto ni de la otra tienda, en el menú ni en el pie.
        await expect(page.getByRole('link', { name: t.oculta })).toHaveCount(0)
        await expect(page.getByRole('link', { name: otra.propia })).toHaveCount(0)
        await expect(page.getByTestId('pie-categorias').getByRole('link', { name: t.propia })).toBeVisible()

        // La categoría propia abre con migas y título; la marca deja de ser el h1.
        await menu.getByRole('link', { name: t.propia }).click()
        await expect(page.getByRole('heading', { level: 1, name: t.propia })).toBeVisible()
        await expect(menu.getByRole('link', { name: t.propia })).toHaveAttribute('aria-current', 'page')

        // Oculta, de la otra tienda e inexistente: la misma 404 amable.
        for (const id of [t.ocultaId, otra.propiaId, randomUUID()]) {
          await page.goto(`http://${t.host}:${puerto}/categoria/${id}`)
          await expect(page.getByTestId('pagina-no-encontrada')).toBeVisible()
          await expect(page.getByText(t.oculta)).toHaveCount(0)
          await expect(page.getByText(otra.propia)).toHaveCount(0)
        }
        await contexto.close()
      }
    } finally {
      // Limpieza: las filas de categorias_tienda caen en cascada con la categoría.
      for (const t of tiendas) {
        await borrar('categorias', `organizacion_id=eq.${t.organizacion}&nombre=like.*${sufijo}`)
      }
    }
  })
})
