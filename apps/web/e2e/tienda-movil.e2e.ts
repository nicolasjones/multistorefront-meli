import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

// F-TDA-17 (MSF-421, SC-008 de la épica MSF-191): con los dos dominios del seed (mundojc.localhost y
// sanjavucho.localhost) la home, el catálogo, la categoría, los resultados, la ficha, la 404 y «Volvemos
// pronto» no tienen scroll horizontal en 360, 390, 412, 430, 768 y 1024 px; el menú y el panel de filtros
// de celular se operan; y un fallo de red muestra el error con «Reintentar». Requiere el stack local
// (`pnpm dev:supabase`) y la web servida; siembra con la API admin desde Node (la service-role key nunca
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

const ANCHOS = [360, 390, 412, 430, 768, 1024] as const
const CELULAR = 390

// Sin scroll horizontal: el contenido nunca es más ancho que la ventana (FR-043).
async function sinScrollHorizontal(page: Page) {
  const { ancho, visible } = await page.evaluate(() => ({ ancho: document.documentElement.scrollWidth, visible: document.documentElement.clientWidth }))
  expect(ancho, 'scrollWidth > clientWidth: hay scroll horizontal').toBeLessThanOrEqual(visible)
}

test.describe('Tienda online · versión móvil (SC-008)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('las pantallas públicas de las dos tiendas no tienen scroll horizontal en 360…1024 px', async ({ browser }) => {
    const sufijo = randomUUID().slice(0, 8)
    const datos: Record<string, { categoria: string; categoriaId: string; productoId: string; producto: string }> = {}
    try {
      for (const t of TIENDAS) {
        const categoria = `Cat movil ${t.nombre} ${sufijo}`
        const producto = `Producto movil ${t.nombre} con un nombre bastante largo para probar el corte ${sufijo}`
        const [cat] = await insertar<{ id: string }>('categorias', [{ organizacion_id: t.organizacion, nombre: categoria }])
        const [prod] = await insertar<{ id: string }>('productos', [{
          organizacion_id: t.organizacion, nombre: producto, sku: `E2E-M-${sufijo}-${t.host.slice(0, 3)}`,
          precio_lista: 12345, moneda: 'ARS', categoria_id: cat.id,
        }])
        await insertar('producto_empresa', [{ producto_id: prod.id, empresa_id: t.empresa, organizacion_id: t.organizacion }])
        await insertar('productos_tienda', [{ empresa_id: t.empresa, producto_id: prod.id, organizacion_id: t.organizacion, visible: true, destacado: true }])
        datos[t.host] = { categoria, categoriaId: cat.id, productoId: prod.id, producto }
      }

      for (const t of TIENDAS) {
        const d = datos[t.host]
        for (const ancho of ANCHOS) {
          const contexto = await browser.newContext({ viewport: { width: ancho, height: 800 }, hasTouch: ancho < 768, isMobile: ancho < 768 })
          const page = await contexto.newPage()
          const base = `http://${t.host}:${puerto}`
          const rutas = [
            ['home', '/', page.getByRole('heading', { level: 2, name: 'Destacados' })],
            ['catálogo', '/catalogo', page.getByTestId('catalogo-contador')],
            ['categoría', `/categoria/${d.categoriaId}`, page.getByTestId('catalogo-contador')],
            ['resultados', '/catalogo?q=movil', page.getByTestId('catalogo-contador')],
            ['ficha', `/producto/${d.productoId}`, page.getByRole('heading', { level: 1 })],
            ['404', '/no-existe-esta-ruta', page.getByTestId('pagina-no-encontrada')],
          ] as const
          for (const [nombre, ruta, listo] of rutas) {
            await page.goto(`${base}${ruta}`)
            await expect(listo, `${t.host} ${nombre} a ${ancho} px`).toBeVisible()
            await sinScrollHorizontal(page)
          }
          // El buscador está siempre alcanzable (FR-043) y su desplegable cabe en el ancho (FR-044).
          await page.goto(`${base}/`)
          const campo = page.getByRole('combobox', { name: 'Buscar productos' })
          await expect(campo).toBeVisible()
          await campo.fill('movil')
          await expect(page.getByRole('listbox', { name: 'Sugerencias de búsqueda' })).toBeVisible()
          await sinScrollHorizontal(page)
          const caja = await page.getByRole('listbox', { name: 'Sugerencias de búsqueda' }).boundingBox()
          expect(caja!.x + caja!.width).toBeLessThanOrEqual(ancho)
          await contexto.close()
        }
      }

      // «Volvemos pronto»: dominio sin tienda, sin scroll horizontal en cada ancho.
      for (const ancho of ANCHOS) {
        const contexto = await browser.newContext({ viewport: { width: ancho, height: 800 } })
        const page = await contexto.newPage()
        await page.goto(`http://sin-tienda-${sufijo}.localhost:${puerto}/`)
        await expect(page.getByRole('heading', { level: 1, name: 'Volvemos pronto' })).toBeVisible()
        await sinScrollHorizontal(page)
        await contexto.close()
      }
    } finally {
      for (const t of TIENDAS) {
        await borrar('productos', `organizacion_id=eq.${t.organizacion}&sku=like.*${sufijo}*`)
        await borrar('categorias', `organizacion_id=eq.${t.organizacion}&nombre=like.*${sufijo}`)
      }
    }
  })

  test('menú y filtros operables en celular, y error de red con reintento que conserva la URL', async ({ browser }) => {
    const sufijo = randomUUID().slice(0, 8)
    const t = TIENDAS[0]
    try {
      const categoria = `Cat filtros ${sufijo}`
      const [cat] = await insertar<{ id: string }>('categorias', [{ organizacion_id: t.organizacion, nombre: categoria }])
      const productos = await insertar<{ id: string }>('productos', ['A', 'B'].map((n) => ({
        organizacion_id: t.organizacion, nombre: `Filtro ${n} ${sufijo}`, sku: `E2E-MF-${n}-${sufijo}`,
        precio_lista: 1000, moneda: 'ARS', categoria_id: cat.id,
      })))
      await insertar('producto_empresa', productos.map((p) => ({ producto_id: p.id, empresa_id: t.empresa, organizacion_id: t.organizacion })))

      const contexto = await browser.newContext({ viewport: { width: CELULAR, height: 800 }, hasTouch: true, isMobile: true })
      const page = await contexto.newPage()
      const base = `http://${t.host}:${puerto}`
      await page.goto(`${base}/`)

      // Menú: abre, lista «Inicio» y la categoría (sin «Contacto»), navega y se cierra.
      await page.getByRole('button', { name: 'Abrir menú' }).click()
      const menu = page.getByRole('dialog', { name: 'Menú' })
      await expect(menu.getByRole('link', { name: 'Inicio' })).toBeVisible()
      await expect(menu.getByText(/contacto/i)).toHaveCount(0)
      await page.keyboard.press('Escape')
      await expect(menu).toBeHidden()
      await expect(page.getByRole('button', { name: 'Abrir menú' })).toBeFocused()
      await page.getByRole('button', { name: 'Abrir menú' }).click()
      await menu.getByRole('link', { name: categoria }).click()
      await expect(page).toHaveURL(new RegExp(`/categoria/${cat.id}$`))
      await expect(menu).toBeHidden()

      // Filtros: «Filtrar» abre el panel, «Solo con stock» llega a la URL y «Ver N productos» cierra.
      await page.goto(`${base}/catalogo`)
      await expect(page.getByTestId('catalogo-contador')).toBeVisible()
      await page.getByTestId('filtrar-movil').click()
      const panel = page.getByRole('dialog', { name: 'Filtros' })
      await expect(panel.getByRole('textbox', { name: 'Precio máximo' })).toBeVisible()
      await panel.getByRole('button', { name: 'Solo con stock' }).click()
      await expect(page).toHaveURL(/stock=1/)
      await panel.getByRole('button', { name: /^Ver .* productos?$/ }).click()
      await expect(panel).toBeHidden()
      await expect(page.getByTestId('filtrar-movil')).toContainText('1')

      // Conexión caída: el pedido falla, aparece el error y «Reintentar» recupera conservando URL y filtros.
      const rutaBloqueo = /\/rest\/v1\//
      await page.route(rutaBloqueo, (ruta) => ruta.abort())
      await page.getByTestId('filtrar-movil').click()
      await page.getByRole('dialog', { name: 'Filtros' }).getByRole('textbox', { name: 'Precio máximo' }).fill('999999')
      await page.getByRole('dialog', { name: 'Filtros' }).getByRole('textbox', { name: 'Precio máximo' }).blur()
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('error-con-reintento')).toBeVisible()
      const urlAntes = page.url()
      await page.unroute(rutaBloqueo)
      await page.getByRole('button', { name: 'Reintentar' }).click()
      await expect(page.getByTestId('error-con-reintento')).toHaveCount(0)
      await expect(page.getByTestId('catalogo-contador')).toBeVisible()
      expect(page.url()).toBe(urlAntes)
      await contexto.close()
    } finally {
      await borrar('productos', `organizacion_id=eq.${t.organizacion}&sku=like.*${sufijo}`)
      await borrar('categorias', `organizacion_id=eq.${t.organizacion}&nombre=like.*${sufijo}`)
    }
  })
})
