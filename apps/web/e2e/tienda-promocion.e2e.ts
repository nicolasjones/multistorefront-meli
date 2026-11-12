import { randomUUID } from 'node:crypto'
import { expect, test } from './fixture'

// F-PRE-11 (MSF-439, SC-006): la tienda pública muestra el precio vigente con el anterior tachado
// durante la promoción y el precio normal fuera de ella. Requiere el stack local (`pnpm dev:supabase`,
// que aplica `supabase/seed.sql`) y la web servida; siembra con la API admin desde Node (la service-role
// key nunca llega al navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY se omite.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de promociones: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
}

// Ids fijos de supabase/seed.sql (MSF-241).
const TIENDA = { host: 'mundojc.localhost', organizacion: '0f5eed00-0000-4000-8000-000000000001', empresa: '0f5eed01-0000-4000-8000-000000000001' }

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

async function borrar(tabla: string, filtro: string) {
  const r = await fetch(`${url}/rest/v1/${tabla}?${filtro}`, { method: 'DELETE', headers: cabeceras() })
  if (!r.ok) console.warn(`limpieza E2E: DELETE ${tabla} → ${r.status}`)
}

// MSF-363 (decisión 15): la bandera `promociones_precio` nace APAGADA; el E2E la enciende y devuelve el valor previo al terminar.
async function fijarBandera(clave: string, activa: boolean): Promise<boolean> {
  const ruta = `banderas_plataforma?clave=eq.${clave}`
  const l = await fetch(`${url}/rest/v1/${ruta}&select=activa`, { headers: cabeceras({ 'accept-profile': 'public' }) })
  const previa = l.ok ? ((await l.json()) as { activa: boolean }[])[0]?.activa ?? false : false
  const r = await fetch(`${url}/rest/v1/${ruta}`, {
    method: 'PATCH',
    headers: cabeceras({ 'content-profile': 'public' }),
    body: JSON.stringify({ activa }),
  })
  if (!r.ok) throw new Error(`bandera ${clave}: ${r.status} ${await r.text()}`)
  return previa
}

const puerto = new URL(process.env.E2E_BASE_URL ?? `http://localhost:${Number(process.env.WEB_PORT) || 4300}`).port
const DIA = 24 * 60 * 60 * 1000

test.describe('Tienda online · precio promocional (SC-006)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-439:T020] [F-PRE-11#1] precio anterior tachado durante la promoción y precio normal fuera de ella', async ({ page }) => {
    const sufijo = randomUUID().slice(0, 8)
    const nombres = { vigente: `Promo vigente ${sufijo}`, vencida: `Promo vencida ${sufijo}` }
    let banderaPrevia = false
    try {
      banderaPrevia = await fijarBandera('promociones_precio', true)
      // Lista $ 1.000 sin IVA (sin regla de empresa ni interruptor, el público es el de lista). La vigente
      // rebaja a $ 800; la vencida terminó ayer y ya no debe verse.
      const [vigente, vencida] = await insertar<{ id: string }>('productos', [
        { organizacion_id: TIENDA.organizacion, nombre: nombres.vigente, sku: `E2E-P-1-${sufijo}`, precio_lista: 1000, moneda: 'ARS' },
        { organizacion_id: TIENDA.organizacion, nombre: nombres.vencida, sku: `E2E-P-2-${sufijo}`, precio_lista: 1000, moneda: 'ARS' },
      ])
      await insertar('producto_empresa', [vigente, vencida].map((p) => ({ producto_id: p.id, empresa_id: TIENDA.empresa, organizacion_id: TIENDA.organizacion })))
      const ahora = Date.now()
      await insertar('promociones_precio', [
        { organizacion_id: TIENDA.organizacion, empresa_id: TIENDA.empresa, producto_id: vigente.id, precio_promocional: 800, desde: new Date(ahora - DIA).toISOString(), hasta: new Date(ahora + DIA).toISOString() },
        { organizacion_id: TIENDA.organizacion, empresa_id: TIENDA.empresa, producto_id: vencida.id, precio_promocional: 800, desde: new Date(ahora - 3 * DIA).toISOString(), hasta: new Date(ahora - DIA).toISOString() },
      ])

      const base = `http://${TIENDA.host}:${puerto}`

      // Ficha con promoción: precio vigente + anterior tachado, con texto para lector de pantalla.
      await page.goto(`${base}/producto/${vigente.id}`)
      await expect(page.getByRole('heading', { level: 1, name: nombres.vigente })).toBeVisible()
      const promo = page.getByTestId('precio-promocional')
      await expect(promo).toContainText('Precio actual $ 800')
      await expect(promo.getByTestId('precio-anterior')).toHaveText('$ 1.000')
      await expect(promo).toContainText('Precio anterior')

      // Ficha de la promoción vencida: precio normal, sin tachado.
      await page.goto(`${base}/producto/${vencida.id}`)
      await expect(page.getByRole('heading', { level: 1, name: nombres.vencida })).toBeVisible()
      await expect(page.getByText('$ 1.000', { exact: true })).toBeVisible()
      await expect(page.getByTestId('precio-promocional')).toHaveCount(0)

      // Catálogo: la tarjeta con promoción tacha el anterior y la vencida no.
      await page.goto(`${base}/catalogo`)
      const tarjeta = (nombre: string) => page.getByRole('heading', { level: 3, name: nombre }).locator('xpath=..')
      await expect(tarjeta(nombres.vigente).getByTestId('precio-anterior')).toHaveText('$ 1.000')
      await expect(tarjeta(nombres.vencida)).toContainText('$ 1.000')
      await expect(tarjeta(nombres.vencida).getByTestId('precio-promocional')).toHaveCount(0)
    } finally {
      await fijarBandera('promociones_precio', banderaPrevia).catch((e: unknown) => console.warn('limpieza E2E: bandera', e))
      await borrar('productos', `organizacion_id=eq.${TIENDA.organizacion}&sku=like.*${sufijo}`)
    }
  })
})
