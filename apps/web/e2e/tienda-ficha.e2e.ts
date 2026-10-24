import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

// F-TDA-13 (MSF-372, SC-008 de la épica MSF-167): con los dos dominios del seed (mundojc.localhost y
// sanjavucho.localhost) la ficha muestra galería y ampliación, el precio de la empresa y la 404 de un
// producto oculto o de la otra tienda. Requiere el stack local (`pnpm dev:supabase`, que aplica
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

// PNG de 1×1 píxel (válido para el navegador y para el bucket).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

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

async function subirImagen(ruta: string) {
  const r = await fetch(`${url}/storage/v1/object/productos-imagenes/${ruta}`, {
    method: 'POST',
    headers: { apikey: serviceKey ?? '', authorization: `Bearer ${serviceKey}`, 'content-type': 'image/png' },
    body: PNG,
  })
  if (!r.ok) throw new Error(`Storage ${ruta}: ${r.status} ${await r.text()}`)
}

async function borrarImagenes(rutas: string[]) {
  if (rutas.length === 0) return
  const r = await fetch(`${url}/storage/v1/object/productos-imagenes`, {
    method: 'DELETE',
    headers: { apikey: serviceKey ?? '', authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ prefixes: rutas }),
  })
  if (!r.ok) console.warn(`limpieza E2E: DELETE storage → ${r.status}`)
}

// Puerto con el que se sirve el panel: los subdominios de `localhost` resuelven a loopback en Chromium.
const puerto = new URL(process.env.E2E_BASE_URL ?? `http://localhost:${Number(process.env.WEB_PORT) || 4300}`).port

test.describe('Tienda online · ficha de producto (SC-008)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('galería, ampliación, precio de la empresa y 404 de producto oculto o de otra tienda', async ({ browser }) => {
    const sufijo = randomUUID().slice(0, 8)
    const tiendas = TIENDAS.map((t, i) => ({
      ...t,
      indice: i,
      categoria: `Cat ${t.nombre} ${sufijo}`,
      completo: `Completo ${t.nombre} ${sufijo}`,
      simple: `Simple ${t.nombre} ${sufijo}`,
      oculto: `Oculto ${t.nombre} ${sufijo}`,
      completoId: '',
      simpleId: '',
      ocultoId: '',
      rutas: [] as string[],
    }))

    try {
      for (const t of tiendas) {
        const [categoria] = await insertar<{ id: string }>('categorias', [{ organizacion_id: t.organizacion, nombre: t.categoria }])
        // Completo $ 1.000 (con stock, 3 imágenes, SKU, descripción con HTML y compatibilidad) · Simple $ 2.000
        // (sin stock, sin imágenes ni compatibilidad) · Oculto (la tienda lo oculta). Sin regla de empresa ni
        // interruptor de IVA, el precio público es el de lista.
        const [completo, simple, oculto] = await insertar<{ id: string }>('productos', [
          {
            organizacion_id: t.organizacion, nombre: t.completo, sku: `E2E-F-${t.indice}-1-${sufijo}`, precio_lista: 1000, moneda: 'ARS',
            categoria_id: categoria.id, descripcion: `Descripción <b>${t.nombre}</b> ${sufijo}`, compatible_con: ['PS4', 'PS5'],
          },
          { organizacion_id: t.organizacion, nombre: t.simple, sku: `E2E-F-${t.indice}-2-${sufijo}`, precio_lista: 2000, moneda: 'ARS', categoria_id: categoria.id },
          { organizacion_id: t.organizacion, nombre: t.oculto, sku: `E2E-F-${t.indice}-3-${sufijo}`, precio_lista: 3000, moneda: 'ARS', categoria_id: categoria.id },
        ])
        t.completoId = completo.id
        t.simpleId = simple.id
        t.ocultoId = oculto.id
        await insertar('producto_empresa', [completo, simple, oculto].map((p) => ({ producto_id: p.id, empresa_id: t.empresa, organizacion_id: t.organizacion })))
        await insertar('productos_tienda', { empresa_id: t.empresa, producto_id: oculto.id, organizacion_id: t.organizacion, visible: false })
        // La fila de existencias nace con el producto (trigger) en 0.
        await actualizar('existencias', `producto_id=eq.${completo.id}`, { cantidad: 5 })

        t.rutas = [1, 2, 3].map((n) => `${t.organizacion}/${completo.id}/imagen-${n}.png`)
        for (const ruta of t.rutas) await subirImagen(ruta)
        await insertar('producto_imagenes', t.rutas.map((ruta, n) => ({
          producto_id: completo.id, organizacion_id: t.organizacion, posicion: n + 1, ruta,
        })))
      }

      for (const t of tiendas) {
        const otra = tiendas.find((x) => x.host !== t.host)!
        const base = `http://${t.host}:${puerto}`
        const contexto = await browser.newContext()
        const page = await contexto.newPage()

        // Ficha completa: migas, nombre, precio de la empresa, disponibilidad, descripción escapada, datos y compatibilidad.
        await page.goto(`${base}/producto/${t.completoId}`)
        await expect(page.getByRole('heading', { level: 1, name: t.completo })).toBeVisible()
        const migas = page.getByRole('navigation', { name: 'Migas de pan' })
        await expect(migas.getByRole('link', { name: 'Todos los productos' })).toHaveAttribute('href', '/catalogo')
        await expect(page.getByText('$ 1.000', { exact: true })).toBeVisible()
        await expect(page.getByTestId('etiqueta-disponibilidad').first()).toHaveText('Disponible')
        await expect(page.getByText(`Descripción <b>${t.nombre}</b> ${sufijo}`)).toBeVisible()
        const datos = page.getByLabel('Datos del producto')
        await expect(datos).toContainText(`E2E-F-${t.indice}-1-${sufijo}`)
        await expect(datos).toContainText(t.categoria)
        await expect(page.getByTestId('compatibilidad')).toContainText('PS4, PS5')
        await expect(page.getByText('Precios y disponibilidad sujetos a cambios.')).toBeVisible()
        await expect(page.getByText(otra.categoria)).toHaveCount(0)
        // Ningún número de stock en la página.
        await expect(page.getByText(/\b5 unidades\b/)).toHaveCount(0)

        // Galería: principal + 3 miniaturas; elegir otra cambia la principal.
        const principal = page.getByRole('button', { name: 'Ampliar imagen' }).locator('img')
        await expect(principal).toBeVisible()
        const miniaturas = page.getByTestId('miniatura')
        await expect(miniaturas).toHaveCount(3)
        await expect(miniaturas.first()).toHaveAttribute('aria-pressed', 'true')
        const srcPrimera = await principal.getAttribute('src')
        await miniaturas.nth(1).click()
        await expect(miniaturas.nth(1)).toHaveAttribute('aria-pressed', 'true')
        await expect(principal).not.toHaveAttribute('src', srcPrimera ?? '')

        // Ampliación: abre un diálogo con la imagen elegida; Esc lo cierra y el foco vuelve al disparador.
        const srcSegunda = await principal.getAttribute('src')
        await page.getByRole('button', { name: 'Ampliar imagen' }).click()
        const dialogo = page.getByRole('dialog', { name: `Imagen ampliada de ${t.completo}` })
        await expect(dialogo).toBeVisible()
        await expect(dialogo.getByRole('img', { name: t.completo })).toHaveAttribute('src', srcSegunda ?? '')
        await page.keyboard.press('Escape')
        await expect(dialogo).toBeHidden()
        await expect(page.getByRole('button', { name: 'Ampliar imagen' })).toBeFocused()
        // Y con el botón de cierre.
        await page.getByRole('button', { name: 'Ampliar imagen' }).click()
        await page.getByRole('button', { name: 'Cerrar imagen ampliada' }).click()
        await expect(dialogo).toBeHidden()

        // «Ver más productos» lleva al catálogo de ESTA tienda.
        await page.getByRole('link', { name: 'Ver más productos' }).click()
        await expect(page).toHaveURL(`${base}/catalogo`)
        await expect(page.getByRole('heading', { level: 1, name: 'Todos los productos' })).toBeVisible()

        // Ficha simple: «Sin imagen», «Sin stock», sin bloque de compatibilidad.
        await page.goto(`${base}/producto/${t.simpleId}`)
        await expect(page.getByRole('heading', { level: 1, name: t.simple })).toBeVisible()
        await expect(page.getByText('$ 2.000', { exact: true })).toBeVisible()
        await expect(page.getByTestId('etiqueta-disponibilidad').first()).toHaveText('Sin stock')
        await expect(page.getByTestId('galeria-sin-imagen')).toHaveText('Sin imagen')
        await expect(page.getByTestId('compatibilidad')).toHaveCount(0)

        // 404 amable: producto oculto, de la otra tienda, inexistente e id inválido (la misma pantalla).
        for (const id of [t.ocultoId, otra.completoId, randomUUID(), 'no-es-un-id']) {
          await page.goto(`${base}/producto/${id}`)
          await expect(page.getByTestId('pagina-no-encontrada')).toBeVisible()
          await expect(page.getByText(t.oculto)).toHaveCount(0)
          await expect(page.getByText(otra.completo)).toHaveCount(0)
        }
        await contexto.close()
      }
    } finally {
      // Limpieza: los productos caen en cascada con sus existencias, imágenes y filas de tienda.
      await borrarImagenes(tiendas.flatMap((t) => t.rutas))
      for (const t of tiendas) {
        await borrar('productos', `organizacion_id=eq.${t.organizacion}&sku=like.*${sufijo}`)
        await borrar('categorias', `organizacion_id=eq.${t.organizacion}&nombre=like.*${sufijo}`)
      }
    }
  })
})
