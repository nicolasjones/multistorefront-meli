import { randomUUID } from 'node:crypto'
import { expect, test } from './fixture'

// F-TDA-25 (MSF-325, SC-008 de la épica MSF-164): con los dos dominios del seed (mundojc.localhost y
// sanjavucho.localhost) la ficha muestra «Compartir»: con el selector del sistema simulado se llama con el
// nombre y el enlace de ESA tienda; sin selector copia con el aviso «Enlace copiado»; con el portapapeles
// rechazado muestra el enlace para copiarlo a mano; y no desborda en 320 / 768 / 1440 px. Requiere el stack
// local (`pnpm dev:supabase`, que aplica `supabase/seed.sql`) y la web servida; siembra con la API admin
// desde Node (la service-role key nunca llega al navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
// el archivo se omite: ver docs/e2e-app.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// La service-role key escribe datos: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de compartir: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
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

test.describe('Tienda online · compartir producto (SC-008)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-325:T045] selector simulado, copia con aviso, enlace manual y anchos, en las dos tiendas', async ({ browser }) => {
    const sufijo = randomUUID().slice(0, 8)
    const productos: { id: string; nombre: string; organizacion: string }[] = []

    try {
      for (const [i, t] of TIENDAS.entries()) {
        const nombre = `Compartible ${t.nombre} ${sufijo}`
        const [p] = await insertar<{ id: string }>('productos', [
          { organizacion_id: t.organizacion, nombre, sku: `E2E-C-${i}-${sufijo}`, precio_lista: 1000, moneda: 'ARS' },
        ])
        await insertar('producto_empresa', [{ producto_id: p.id, empresa_id: t.empresa, organizacion_id: t.organizacion }])
        productos.push({ id: p.id, nombre, organizacion: t.organizacion })
      }

      for (const [i, t] of TIENDAS.entries()) {
        const { id, nombre } = productos[i]
        const base = `http://${t.host}:${puerto}`
        const enlaceEsperado = `${base}/producto/${id}`

        // 1) Selector del sistema simulado: se llama con el nombre y el enlace de ESTA tienda; sin avisos.
        let contexto = await browser.newContext()
        let page = await contexto.newPage()
        await page.addInitScript(() => {
          const w = window as unknown as { __compartido: unknown[] }
          w.__compartido = []
          Object.defineProperty(navigator, 'share', {
            configurable: true,
            value: (datos: unknown) => { w.__compartido.push(datos); return Promise.resolve() },
          })
        })
        await page.goto(`${base}/producto/${id}?utm_source=x#arriba`)
        await expect(page.getByRole('heading', { level: 1, name: nombre })).toBeVisible()
        const boton = page.getByRole('button', { name: 'Compartir' })
        await boton.focus()
        await page.keyboard.press('Enter')
        await expect.poll(() => page.evaluate(() => (window as unknown as { __compartido: unknown[] }).__compartido)).toEqual([
          { title: nombre, url: enlaceEsperado },
        ])
        await expect(page.getByText('Enlace copiado')).toHaveCount(0)
        await contexto.close()

        // 2) Sin selector: copia el enlace (dominio de la tienda, sin parámetros) y avisa.
        contexto = await browser.newContext()
        await contexto.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base })
        page = await contexto.newPage()
        await page.addInitScript(() => Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }))
        await page.goto(`${base}/producto/${id}?utm_source=x`)
        await page.getByRole('button', { name: 'Compartir' }).click()
        await expect(page.getByRole('status').getByText('Enlace copiado')).toBeVisible()
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(enlaceEsperado)
        await contexto.close()

        // 3) Portapapeles rechazado: se muestra el enlace para copiarlo a mano.
        contexto = await browser.newContext()
        page = await contexto.newPage()
        await page.addInitScript(() => {
          Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
          Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: () => Promise.reject(new DOMException('denegado', 'NotAllowedError')) },
          })
        })
        await page.goto(`${base}/producto/${id}`)
        await page.getByRole('button', { name: 'Compartir' }).click()
        await expect(page.getByLabel('Copiá este enlace')).toHaveValue(enlaceEsperado)
        await expect(page.getByText('Enlace copiado')).toHaveCount(0)

        // 4) Anchos: sin desborde horizontal y con el botón visible.
        for (const ancho of [320, 768, 1440]) {
          await page.setViewportSize({ width: ancho, height: 900 })
          await expect(page.getByRole('button', { name: 'Compartir' })).toBeVisible()
          const desborde = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
          expect(desborde, `desborde horizontal a ${ancho} px en ${t.host}`).toBe(false)
        }
        await contexto.close()
      }
    } finally {
      for (const p of productos) {
        await borrar('producto_empresa', `producto_id=eq.${p.id}`)
        await borrar('productos', `id=eq.${p.id}`)
      }
    }
  })
})
