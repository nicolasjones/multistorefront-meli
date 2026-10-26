import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

// F-TDA-15 (MSF-413, SC-006 de la épica MSF-191): con los dos dominios del seed (mundojc.localhost y
// sanjavucho.localhost, ancho de escritorio) el buscador del encabezado encuentra los productos de SU
// tienda con tildes, mayúsculas y errores de tipeo; una sugerencia abre la ficha, «Ver todos los
// resultados →» lleva a `/catalogo?q=…` y esa URL abierta en otro navegador da el mismo resultado. Nunca
// aparecen productos de la otra tienda. Requiere el stack local (`pnpm dev:supabase`, que aplica
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

test.describe('Tienda online · búsqueda de productos (SC-006)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('buscar con tilde, mayúsculas y tipeo, abrir una sugerencia y ver todos los resultados', async ({ browser }) => {
    // Un sufijo alfabético: el texto buscado es «cargdor» + el sufijo no entra en la consulta.
    const sufijo = randomUUID().slice(0, 8)
    const tiendas = TIENDAS.map((t, i) => ({
      ...t,
      indice: i,
      categoria: `Cat busq ${t.nombre} ${sufijo}`,
      cargador: `Cargador ${t.nombre} ${sufijo}`,
      cable: `Cable ${t.nombre} ${sufijo}`,
      cargadorId: '',
    }))

    try {
      for (const t of tiendas) {
        const [categoria] = await insertar<{ id: string }>('categorias', [{ organizacion_id: t.organizacion, nombre: t.categoria }])
        // Cargador $ 1.500 (3 en stock) y Cable $ 800 (sin stock). Sin regla de empresa ni IVA, el precio
        // público es el de lista.
        const productos = await insertar<{ id: string; nombre: string }>('productos', [
          { organizacion_id: t.organizacion, nombre: t.cargador, sku: `E2E-B-${t.indice}-C-${sufijo}`, precio_lista: 1500, moneda: 'ARS', categoria_id: categoria.id },
          { organizacion_id: t.organizacion, nombre: t.cable, sku: `E2E-B-${t.indice}-K-${sufijo}`, precio_lista: 800, moneda: 'ARS', categoria_id: categoria.id },
        ])
        await insertar('producto_empresa', productos.map((p) => ({ producto_id: p.id, empresa_id: t.empresa, organizacion_id: t.organizacion })))
        t.cargadorId = productos.find((p) => p.nombre === t.cargador)!.id
        await actualizar('existencias', `producto_id=eq.${t.cargadorId}`, { cantidad: 3 })
      }

      for (const t of tiendas) {
        const otra = tiendas.find((x) => x.host !== t.host)!
        const base = `http://${t.host}:${puerto}`
        const contexto = await browser.newContext()
        const page = await contexto.newPage()
        const campo = page.getByRole('combobox', { name: 'Buscar productos' })
        const opciones = page.getByRole('option')

        // Errores de tipeo, mayúsculas y tildes encuentran el producto de ESTA tienda y de ninguna otra.
        await page.goto(`${base}/`)
        for (const consulta of ['cargdor', 'CARGADOR', 'cárgador']) {
          await campo.fill(consulta)
          await expect(page.getByRole('option', { name: new RegExp(t.cargador) })).toBeVisible()
          await expect(page.getByRole('option', { name: new RegExp(t.cargador) })).toContainText('$ 1.500')
          await expect(page.getByRole('option', { name: new RegExp(t.cargador) })).toContainText('Disponible')
          await expect(page.getByText(otra.cargador)).toHaveCount(0)
        }

        // Sin coincidencias: mensaje del desplegable.
        await campo.fill('zzqxy')
        await expect(page.getByText('No encontramos productos con ese nombre.')).toBeVisible()
        await expect(opciones).toHaveCount(0)

        // Abrir una sugerencia lleva a la ficha del producto.
        await campo.fill('cargdor')
        await page.getByRole('option', { name: new RegExp(t.cargador) }).click()
        await expect(page).toHaveURL(new RegExp(`/producto/${t.cargadorId}$`))
        await expect(page.getByRole('heading', { level: 1, name: t.cargador })).toBeVisible()

        // «Ver todos los resultados →» → /catalogo?q=… con título, migas y solo productos de esta tienda.
        await page.goto(`${base}/`)
        await campo.fill('cargdor')
        await expect(page.getByRole('option', { name: new RegExp(t.cargador) })).toBeVisible()
        await page.getByRole('option', { name: /Ver todos los resultados/ }).click()
        await expect(page).toHaveURL(/\/catalogo\?q=cargdor$/)
        await expect(page.getByRole('heading', { level: 1, name: 'Resultados para “cargdor”' })).toBeVisible()
        await expect(page.getByRole('navigation', { name: 'Migas de pan' })).toContainText('Resultados')
        await expect(page.getByTestId('tarjeta-producto').filter({ hasText: t.cargador })).toHaveCount(1)
        await expect(page.getByText(t.cable)).toHaveCount(0)
        await expect(page.getByText(otra.cargador)).toHaveCount(0)

        // Los filtros conservan q.
        await page.getByRole('button', { name: 'Solo con stock' }).click()
        await expect(page).toHaveURL(/q=cargdor/)
        await expect(page).toHaveURL(/stock=1/)

        // URL compartible: la URL copiada, abierta en otro navegador, da el mismo resultado.
        const compartida = page.url()
        const otroContexto = await browser.newContext()
        const otraPagina = await otroContexto.newPage()
        await otraPagina.goto(compartida)
        await expect(otraPagina.getByRole('heading', { level: 1, name: 'Resultados para “cargdor”' })).toBeVisible()
        await expect(otraPagina.getByTestId('tarjeta-producto').filter({ hasText: t.cargador })).toHaveCount(1)
        await expect(otraPagina.getByText(otra.cargador)).toHaveCount(0)
        await otroContexto.close()

        // Enter sin sugerencia elegida también lleva a los resultados.
        await page.goto(`${base}/`)
        await campo.fill('cable')
        await expect(page.getByRole('option', { name: new RegExp(t.cable) })).toBeVisible()
        await campo.press('Escape')
        await campo.press('Enter')
        await expect(page).toHaveURL(/\/catalogo\?q=cable$/)
        await expect(page.getByTestId('tarjeta-producto').filter({ hasText: t.cable })).toHaveCount(1)
        await contexto.close()
      }
    } finally {
      // Limpieza: los productos caen en cascada con sus existencias y filas de tienda.
      for (const t of tiendas) {
        await borrar('productos', `organizacion_id=eq.${t.organizacion}&sku=like.*${sufijo}`)
        await borrar('categorias', `organizacion_id=eq.${t.organizacion}&nombre=like.*${sufijo}`)
      }
    }
  })
})
