import { randomUUID } from 'node:crypto'
import { expect, test } from './fixture'

// F-TDA-19 (MSF-247, épica MSF-149): estados especiales de la tienda con los dos dominios del seed
// (mundojc.localhost y sanjavucho.localhost). Requiere el stack local (`pnpm dev:supabase`, que aplica
// `supabase/seed.sql`) y la web servida; siembra con la API admin desde Node (la service-role key nunca llega
// al navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se omite (no entra al CI público):
// ver docs/e2e-app.md. «Store activa» se apaga con el mismo campo (`dominio.empresas.activa`) que el botón
// «Pausar tienda» de Empresas (F-EMP-04).
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// La service-role key escribe datos: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de estados de tienda: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
}

// Ids fijos de supabase/seed.sql (MSF-241).
const TIENDAS = [
  { host: 'mundojc.localhost', organizacion: '0f5eed00-0000-4000-8000-000000000001', empresa: '0f5eed01-0000-4000-8000-000000000001', nombre: 'Mundo JC' },
  { host: 'sanjavucho.localhost', organizacion: '0f5eed00-0000-4000-8000-000000000002', empresa: '0f5eed01-0000-4000-8000-000000000002', nombre: 'San Javucho' },
] as const

const ANCHOS = [320, 768, 1440] as const

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

async function actualizar(tabla: string, filtro: string, cuerpo: unknown) {
  const r = await fetch(`${url}/rest/v1/${tabla}?${filtro}`, { method: 'PATCH', headers: cabeceras(), body: JSON.stringify(cuerpo) })
  if (!r.ok) throw new Error(`REST PATCH ${tabla}: ${r.status} ${await r.text()}`)
}

async function borrar(tabla: string, filtro: string) {
  const r = await fetch(`${url}/rest/v1/${tabla}?${filtro}`, { method: 'DELETE', headers: cabeceras() })
  if (!r.ok) console.warn(`limpieza E2E: DELETE ${tabla} → ${r.status}`)
}

const activar = (empresa: string, activa: boolean) => actualizar('empresas', `id=eq.${empresa}`, { activa })

// Puerto con el que se sirve el panel: los subdominios de `localhost` resuelven a loopback en Chromium.
const puerto = new URL(process.env.E2E_BASE_URL ?? `http://localhost:${Number(process.env.WEB_PORT) || 4300}`).port
const direccion = (host: string, ruta = '/') => `http://${host}:${puerto}${ruta}`

test.describe('Tienda online · estados especiales (F-TDA-19)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  const sufijo = randomUUID().slice(0, 8)

  test.beforeAll(async () => {
    for (const t of TIENDAS) {
      await insertar('tienda_identidad', { empresa_id: t.empresa, organizacion_id: t.organizacion, color_primario: t.host.startsWith('mundo') ? '#AA1111' : '#1111AA' }, 'empresa_id')
      const [producto] = await insertar<{ id: string }>('productos', { organizacion_id: t.organizacion, nombre: `Estados ${t.nombre} ${sufijo}`, sku: `E2E-EST-${t.empresa.slice(-1)}-${sufijo}`, precio_lista: 10 })
      await insertar('producto_empresa', { producto_id: producto.id, empresa_id: t.empresa, organizacion_id: t.organizacion })
    }
  })

  test.afterAll(async () => {
    for (const t of TIENDAS) {
      await activar(t.empresa, true)
      await borrar('productos', `organizacion_id=eq.${t.organizacion}&nombre=like.*${sufijo}`)
      await borrar('tienda_identidad', `empresa_id=eq.${t.empresa}`)
    }
  })

  test('[MSF-247:T008] [F-TDA-19#SC-003] pausar y reactivar: «Volvemos pronto» con la marca propia y luego la tienda', async ({ page }) => {
    for (const t of TIENDAS) {
      const otra = TIENDAS.find((x) => x.host !== t.host)!
      try {
        await activar(t.empresa, false)
        await page.goto(direccion(t.host))
        await expect(page.getByRole('heading', { level: 1, name: 'Volvemos pronto' })).toBeVisible()
        await expect(page.getByTestId('volvemos-pronto-marca')).toBeVisible()
        await expect(page.getByText(t.nombre)).toBeVisible()
        await expect(page.getByText(otra.nombre)).toHaveCount(0)
        await expect(page.getByRole('link')).toHaveCount(0)
        await expect(page.getByText(`Estados ${t.nombre} ${sufijo}`)).toHaveCount(0)

        await activar(t.empresa, true)
        await page.goto(direccion(t.host))
        await expect(page.getByRole('heading', { level: 1, name: t.nombre })).toBeVisible()
        // El inicio ya no lista productos sueltos: el producto de la tienda se encuentra con la búsqueda.
        await page.getByRole('banner').getByRole('combobox', { name: 'Buscar productos' }).fill(`Estados ${t.nombre} ${sufijo}`)
        await expect(page.getByRole('option', { name: new RegExp(`Estados ${t.nombre} ${sufijo}`) })).toBeVisible()
      } finally {
        await activar(t.empresa, true)
      }
    }
  })

  test('[MSF-247:T008] [F-TDA-19#SC-002] dominio desconocido: «Volvemos pronto» genérica, sin marca', async ({ page }) => {
    await page.goto(direccion('no-existe.localhost'))
    await expect(page.getByRole('heading', { level: 1, name: 'Volvemos pronto' })).toBeVisible()
    await expect(page.getByTestId('volvemos-pronto-generica')).toBeVisible()
    for (const t of TIENDAS) await expect(page.getByText(t.nombre)).toHaveCount(0)
  })

  test('[MSF-247:T008] [F-TDA-19#SC-002] 404 con buscador que lleva a resultados', async ({ page }) => {
    const t = TIENDAS[0]
    await page.goto(direccion(t.host, '/ruta-que-no-existe'))
    await expect(page.getByRole('heading', { level: 1, name: 'No encontramos esta página' })).toBeVisible()
    const buscadores = page.getByRole('combobox', { name: 'Buscar productos' })
    await expect(buscadores).toHaveCount(2)
    await buscadores.last().fill('Estados')
    await buscadores.last().press('Enter')
    await expect(page).toHaveURL(/\/catalogo\?q=Estados/)
    await expect(page.getByText(`Estados ${t.nombre} ${sufijo}`)).toBeVisible()
  })

  test('[MSF-247:T008] [F-TDA-19#SC-002] conexión caída: pantalla de error con «Reintentar»', async ({ page }) => {
    const t = TIENDAS[0]
    await page.route('**/rest/v1/rpc/tienda_por_dominio*', (ruta) => ruta.abort('connectionrefused'))
    await page.goto(direccion(t.host))
    await expect(page.getByRole('alert')).toContainText('No pudimos cargar esta página.')
    await expect(page.getByRole('heading', { name: 'Volvemos pronto' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Volver al inicio' })).toBeVisible()

    await page.unroute('**/rest/v1/rpc/tienda_por_dominio*')
    await page.getByRole('button', { name: 'Reintentar' }).click()
    await expect(page.getByRole('heading', { level: 1, name: t.nombre })).toBeVisible()
  })

  for (const ancho of ANCHOS) {
    test(`[MSF-247:T008] [F-TDA-19#FR-005] sin scroll horizontal a ${ancho} px en pausada, 404 y error`, async ({ page }) => {
      const t = TIENDAS[0]
      await page.setViewportSize({ width: ancho, height: 800 })
      const sinScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

      try {
        await activar(t.empresa, false)
        await page.goto(direccion(t.host))
        await expect(page.getByTestId('volvemos-pronto-marca')).toBeVisible()
        expect(await sinScroll()).toBe(true)
      } finally {
        await activar(t.empresa, true)
      }

      await page.goto(direccion(t.host, '/ruta-que-no-existe'))
      await expect(page.getByTestId('pagina-no-encontrada')).toBeVisible()
      expect(await sinScroll()).toBe(true)

      await page.route('**/rest/v1/rpc/tienda_por_dominio*', (ruta) => ruta.abort('connectionrefused'))
      await page.goto(direccion(t.host))
      await expect(page.getByTestId('pantalla-error')).toBeVisible()
      expect(await sinScroll()).toBe(true)
    })
  }
})
