import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

// F-TDA-12 (MSF-355, SC-006 de la épica MSF-167): con los dos dominios del seed (mundojc.localhost y
// sanjavucho.localhost) el menú lleva a la categoría; los filtros, el orden y la paginación cambian el
// listado sin recargar y la URL copiada da el mismo resultado al reabrirla. Requiere el stack local
// (`pnpm dev:supabase`, que aplica `supabase/seed.sql`) y la web servida; siembra con la API admin desde
// Node (la service-role key nunca llega al navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el
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

const MASIVOS = 26 // 24 en la primera página y 2 en la segunda

test.describe('Tienda online · catálogo con filtros y orden (SC-006)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('menú → categoría, filtros, orden, paginación y URL compartible', async ({ browser }) => {
    const sufijo = randomUUID().slice(0, 8)
    const tiendas = TIENDAS.map((t, i) => ({
      ...t,
      categoria: `Cat ${t.nombre} ${sufijo}`,
      masiva: `Masiva ${t.nombre} ${sufijo}`,
      barato: `Barato ${t.nombre} ${sufijo}`,
      medio: `Medio ${t.nombre} ${sufijo}`,
      caro: `Caro ${t.nombre} ${sufijo}`,
      indice: i,
      categoriaId: '',
      masivaId: '',
    }))

    try {
      for (const t of tiendas) {
        const [categoria, masiva] = await insertar<{ id: string }>('categorias', [
          { organizacion_id: t.organizacion, nombre: t.categoria },
          { organizacion_id: t.organizacion, nombre: t.masiva },
        ])
        t.categoriaId = categoria.id
        t.masivaId = masiva.id

        // Barato $ 1.000 (5 en stock) · Medio $ 2.000 (sin stock) · Caro $ 3.000 (2 en stock). Sin regla de
        // empresa ni interruptor de IVA, el precio público es el de lista.
        const base = [
          { nombre: t.barato, precio: 1000 },
          { nombre: t.medio, precio: 2000 },
          { nombre: t.caro, precio: 3000 },
        ].map((p, n) => ({
          organizacion_id: t.organizacion, nombre: p.nombre, sku: `E2E-C-${t.indice}-${n}-${sufijo}`,
          precio_lista: p.precio, moneda: 'ARS', categoria_id: categoria.id,
        }))
        const masivos = Array.from({ length: MASIVOS }, (_, n) => ({
          organizacion_id: t.organizacion, nombre: `${t.masiva} ${String(n + 1).padStart(2, '0')}`,
          sku: `E2E-M-${t.indice}-${n}-${sufijo}`, precio_lista: 100 + n, moneda: 'ARS', categoria_id: masiva.id,
        }))
        const productos = await insertar<{ id: string; nombre: string }>('productos', [...base, ...masivos])
        await insertar('producto_empresa', productos.map((p) => ({ producto_id: p.id, empresa_id: t.empresa, organizacion_id: t.organizacion })))
        // La fila de existencias nace con el producto (trigger) en 0.
        await actualizar('existencias', `producto_id=eq.${productos.find((p) => p.nombre === t.barato)!.id}`, { cantidad: 5 })
        await actualizar('existencias', `producto_id=eq.${productos.find((p) => p.nombre === t.caro)!.id}`, { cantidad: 2 })
      }

      for (const t of tiendas) {
        const otra = tiendas.find((x) => x.host !== t.host)!
        const base = `http://${t.host}:${puerto}`
        const contexto = await browser.newContext()
        const page = await contexto.newPage()
        const tarjetas = page.getByTestId('tarjeta-producto')
        const contador = page.getByTestId('catalogo-contador')

        // Menú → categoría: solo sus 3 productos, con precio y disponibilidad.
        await page.goto(`${base}/`)
        await page.getByRole('navigation', { name: 'Categorías' }).getByRole('link', { name: t.categoria }).click()
        await expect(page.getByRole('heading', { level: 1, name: t.categoria })).toBeVisible()
        await expect(contador).toHaveText('3 productos')
        await expect(tarjetas).toHaveCount(3)
        await expect(page.getByRole('link', { name: new RegExp(t.barato) })).toContainText('$ 1.000')
        await expect(page.getByRole('link', { name: new RegExp(t.medio) })).toContainText('Sin stock')
        await expect(page.getByText(otra.barato)).toHaveCount(0)

        // «Solo con stock» saca al producto sin existencias y queda en la URL.
        await page.getByRole('button', { name: 'Solo con stock' }).click()
        await expect(contador).toHaveText('2 productos')
        await expect(page.getByText(t.medio)).toHaveCount(0)
        await expect(page).toHaveURL(/stock=1/)

        // «Limpiar filtros» vuelve a los 3.
        await page.getByRole('button', { name: 'Limpiar filtros' }).click()
        await expect(contador).toHaveText('3 productos')
        await expect(page).not.toHaveURL(/stock=1/)

        // Precio máximo + orden «Mayor precio»: Medio ($ 2.000) primero, Caro ($ 3.000) afuera.
        const campo = page.getByRole('textbox', { name: 'Precio máximo' })
        await campo.fill('2500')
        await campo.press('Enter')
        await expect(contador).toHaveText('2 productos')
        await page.getByRole('combobox', { name: 'Ordenar por' }).click()
        await page.getByRole('option', { name: 'Mayor precio' }).click()
        await expect(tarjetas.first()).toContainText(t.medio)
        await expect(tarjetas.last()).toContainText(t.barato)
        await expect(page).toHaveURL(/max=2500/)
        await expect(page).toHaveURL(/orden=precio_desc/)

        // URL compartible: la URL copiada, abierta en otro navegador, da el mismo resultado.
        const compartida = page.url()
        const otroContexto = await browser.newContext()
        const otraPagina = await otroContexto.newPage()
        await otraPagina.goto(compartida)
        await expect(otraPagina.getByTestId('catalogo-contador')).toHaveText('2 productos')
        await expect(otraPagina.getByTestId('tarjeta-producto').first()).toContainText(t.medio)
        await expect(otraPagina.getByRole('textbox', { name: 'Precio máximo' })).toHaveValue('2500')
        await expect(otraPagina.getByRole('combobox', { name: 'Ordenar por' })).toHaveText('Mayor precio')
        await otroContexto.close()

        // Paginación de a 24 en el catálogo general filtrado por la categoría masiva.
        await page.goto(`${base}/catalogo?categoria=${t.masivaId}`)
        await expect(contador).toHaveText(`${MASIVOS} productos`)
        await expect(tarjetas).toHaveCount(24)
        await page.getByRole('navigation', { name: 'Paginación del catálogo' }).getByRole('link', { name: 'Ir a la página 2' }).click()
        await expect(page).toHaveURL(/pagina=2/)
        await expect(tarjetas).toHaveCount(MASIVOS - 24)
        await expect(tarjetas.first()).toContainText(`${t.masiva} 25`)
        const paginaDos = page.url()
        await page.goto(paginaDos)
        await expect(tarjetas).toHaveCount(MASIVOS - 24)

        // Cambiar un filtro vuelve a la página 1.
        await page.getByRole('button', { name: 'Solo con stock' }).click()
        await expect(page).not.toHaveURL(/pagina=/)

        // /catalogo sin categoría: nada de la otra tienda y valores inválidos de la URL se ignoran.
        await page.goto(`${base}/catalogo?stock=quizas&max=-4&orden=raro&pagina=0`)
        await expect(page.getByRole('heading', { level: 1, name: 'Todos los productos' })).toBeVisible()
        await expect(tarjetas.first()).toBeVisible()
        await expect(page.getByText(otra.barato)).toHaveCount(0)
        await expect(page.getByText(otra.categoria)).toHaveCount(0)
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
