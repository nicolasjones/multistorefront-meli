import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

// Cierre de la épica MSF-147 (T038, SC-003): con los dos dominios del seed (mundojc.localhost y
// sanjavucho.localhost) la identidad, los textos y el catálogo visible de cada tienda cambian solo
// la propia. Requiere el stack local (`pnpm dev:supabase`, que aplica `supabase/seed.sql`) y la web
// servida; siembra la identidad, el contenido y los productos con la API admin desde Node (la
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
    color: '#AA1111',
    bienvenida: 'Bienvenido a Mundo JC',
    pie: 'Pie de Mundo JC',
  },
  {
    host: 'sanjavucho.localhost',
    organizacion: '0f5eed00-0000-4000-8000-000000000002',
    empresa: '0f5eed01-0000-4000-8000-000000000002',
    nombre: 'San Javucho',
    color: '#1111AA',
    bienvenida: 'Bienvenido a San Javucho',
    pie: 'Pie de San Javucho',
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

test.describe('Tienda online · dos dominios (SC-003)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('identidad, textos y catálogo visible de cada tienda cambian solo la propia', async ({ browser }) => {
    const sufijo = randomUUID().slice(0, 8)
    const tiendas = TIENDAS.map((t) => ({
      ...t,
      visible: `Visible ${t.nombre} ${sufijo}`,
      oculto: `Oculto ${t.nombre} ${sufijo}`,
    }))

    try {
      for (const t of tiendas) {
        await insertar('tienda_identidad', { empresa_id: t.empresa, organizacion_id: t.organizacion, color_primario: t.color }, 'empresa_id')
        await insertar('tienda_contenido', { empresa_id: t.empresa, organizacion_id: t.organizacion, bienvenida: t.bienvenida, pie: t.pie }, 'empresa_id')
        const [visible, oculto] = await insertar<{ id: string }>('productos', [
          { organizacion_id: t.organizacion, nombre: t.visible, sku: `E2E-V-${t.empresa.slice(-1)}-${sufijo}`, precio_lista: 10 },
          { organizacion_id: t.organizacion, nombre: t.oculto, sku: `E2E-O-${t.empresa.slice(-1)}-${sufijo}`, precio_lista: 20 },
        ])
        await insertar('producto_empresa', [visible, oculto].map((p) => ({ producto_id: p.id, empresa_id: t.empresa, organizacion_id: t.organizacion })))
        await insertar('productos_tienda', { empresa_id: t.empresa, producto_id: oculto.id, organizacion_id: t.organizacion, visible: false })
      }

      for (const t of tiendas) {
        const otra = tiendas.find((x) => x.host !== t.host)!
        const contexto = await browser.newContext()
        const page = await contexto.newPage()
        await page.goto(`http://${t.host}:${puerto}/`)

        await expect(page.getByRole('heading', { level: 1, name: t.nombre })).toBeVisible()
        await expect(page.getByText(t.bienvenida)).toBeVisible()
        await expect(page.getByText(t.pie)).toBeVisible()
        await expect(page.getByText(t.visible)).toBeVisible()
        // Identidad: el color primario de la propia tienda queda como variable de tema.
        await expect
          .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--tienda-color-primario')))
          .toBe(t.color)

        // Nada de lo oculto ni de la otra tienda.
        await expect(page.getByText(t.oculto)).toHaveCount(0)
        await expect(page.getByText(otra.bienvenida)).toHaveCount(0)
        await expect(page.getByText(otra.pie)).toHaveCount(0)
        await expect(page.getByText(otra.visible)).toHaveCount(0)
        await contexto.close()
      }
    } finally {
      // Limpieza: los productos caen en cascada con sus filas de tienda; identidad y contenido
      // vuelven al estado del seed (sin fila).
      for (const t of tiendas) {
        await borrar('productos', `organizacion_id=eq.${t.organizacion}&nombre=like.*${sufijo}`)
        await borrar('tienda_identidad', `empresa_id=eq.${t.empresa}`)
        await borrar('tienda_contenido', `empresa_id=eq.${t.empresa}`)
      }
    }
  })
})
