import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'

// Capturas de pantalla para la documentación de usuario. NO siembra nada: usa el dataset de demostración
// (`pnpm demo:dataset`, ver docs/dataset-demo.md) ya cargado en el Supabase al que apunta la web. Entra como el
// usuario `admin` del dataset y guarda cada PNG en `<CAPTURAS_DESTINO>/<guía>/NN-paso.png` (por defecto `docs/img`).
// Los diálogos y formularios se abren y se completan pero nunca se confirman: la corrida no modifica datos.
//
// Variables: SUPABASE_URL y SUPABASE_ANON_KEY (para resolver ids), CAPTURAS_DESTINO, DEMO_SUFIJO (opcional).
const url = process.env.SUPABASE_URL
const anon = process.env.SUPABASE_ANON_KEY
const sufijo = process.env.DEMO_SUFIJO ?? ''
const correo = `admin${sufijo}@demo.msf.test`
const password = 'Demo-Msf-2026!'
const DESTINO = path.resolve(process.cwd(), process.env.CAPTURAS_DESTINO ?? '../../docs/img')

async function ingresar(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Correo').fill(correo)
  await page.getByLabel('Contraseña').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

// Id de un producto por SKU, leído como el propio usuario (el esquema `dominio` solo admite `authenticated`).
async function idProducto(sku: string): Promise<string> {
  const t = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: anon ?? '', 'content-type': 'application/json' }, body: JSON.stringify({ email: correo, password }),
  })
  const { access_token: token } = (await t.json()) as { access_token: string }
  const r = await fetch(`${url}/rest/v1/productos?sku=eq.${sku}&select=id`, {
    headers: { apikey: anon ?? '', authorization: `Bearer ${token}`, 'accept-profile': 'dominio' },
  })
  const filas = (await r.json()) as { id: string }[]
  if (!filas[0]) throw new Error(`No hay un producto con SKU ${sku}: ¿está cargado el dataset demo?`)
  return filas[0].id
}

// Guarda el PNG. Sin animaciones ni cursor para que dos corridas con los mismos datos den la misma imagen.
async function capturar(destino: Page | Locator, guia: string, nombre: string) {
  const carpeta = path.join(DESTINO, guia)
  mkdirSync(carpeta, { recursive: true })
  await destino.screenshot({ path: path.join(carpeta, `${nombre}.png`), animations: 'disabled', caret: 'hide' })
}

async function elegirAutocomplete(page: Page, etiqueta: string, opcion: string | RegExp) {
  await page.getByRole('combobox', { name: etiqueta, exact: true }).first().click()
  await page.getByRole('option', { name: opcion }).first().click()
}

// Pantallas de listado: [guía, nombre del archivo, ruta]. Se espera el título de la pantalla y que la red se quede
// quieta (los datos ya llegaron); las imágenes se revisan a ojo después de cada corrida.
const LISTADOS: [string, string, string][] = [
  ['catalogo', '01-listado', '/productos'],
  ['stock', '01-listado', '/stock'],
  ['stock-movimientos', '01-movimientos', '/stock/movimientos'],
  ['stock-depositos', '01-depositos', '/stock/depositos'],
  ['cotizacion', '01-cotizacion', '/cotizacion'],
  ['clientes', '01-listado', '/clientes'],
  ['ventas-comprobantes', '01-listado', '/ventas/comprobantes'],
  ['ventas-despacho', '01-despacho', '/ventas/despacho'],
  ['ventas-pagos', '01-pagos', '/ventas/pagos'],
  ['ventas-devoluciones', '01-rma', '/ventas/devoluciones'],
  ['ventas-cuentas-cobro', '01-cuentas', '/ventas/cuentas-cobro'],
  ['ventas-transportes', '01-transportes', '/ventas/transportes'],
  ['service-tecnico', '01-reparaciones', '/service-tecnico/reparaciones'],
  ['consultas', '01-bandeja', '/consultas'],
  ['actividad', '01-actividad', '/actividad'],
  ['proveedores', '01-listado', '/proveedores'],
]

test.describe('Capturas de la documentación de usuario', () => {
  test.skip(!url || !anon, 'Requiere SUPABASE_URL y SUPABASE_ANON_KEY del Supabase con el dataset demo.')
  test.setTimeout(120_000)

  test('flujos con formulario o diálogo (el piloto)', async ({ page }) => {
    await ingresar(page)

    // Ingreso de mercadería: formulario completo y, debajo, el historial. No se registra.
    await page.goto('/stock/ingresos')
    await elegirAutocomplete(page, 'Compra a nombre de', 'San Javucho')
    await elegirAutocomplete(page, 'Proveedor', /Distribuidora Gamer Norte/)
    await elegirAutocomplete(page, 'Producto 1', /DualSense PS5 negro/)
    await page.getByLabel('Cantidad').first().fill('12')
    await page.getByLabel('Costo unit. USD').first().fill('54')
    // El formulario muestra un texto desactualizado que habla de una «épica» interna (BUG-319 del backlog): se oculta en la
    // captura para que el manual no muestre jerga interna; cuando se corrija la pantalla, este paso sobra.
    await page.getByText(/épica/).first().evaluate((el) => { (el as HTMLElement).style.visibility = 'hidden' }).catch(() => {})
    await capturar(page, 'ingreso-de-mercaderia', '01-formulario')
    await page.getByRole('table').first().scrollIntoViewIfNeeded()
    await capturar(page, 'ingreso-de-mercaderia', '02-historial')

    // Traslado entre depósitos: diálogo completo. No se confirma.
    await page.goto('/stock')
    await page.getByRole('button', { name: /^Trasladar / }).first().click()
    const dialogo = page.getByRole('dialog', { name: 'Trasladar stock entre depósitos' })
    await dialogo.getByRole('combobox', { name: /Depósito de origen/ }).click()
    await page.getByRole('option').first().click()
    await dialogo.getByRole('combobox', { name: /Depósito de destino/ }).click()
    await page.getByRole('option', { name: /Local Corrientes|Depósito Córdoba/ }).first().click()
    await dialogo.getByLabel('Cantidad').fill('5')
    await dialogo.getByLabel('Nota (opcional)').fill('Reposición del local')
    await capturar(dialogo, 'stock-traslados', '01-dialogo')

    // Escalas de precio: bloque del formulario de un producto con escalas x5/x10/x50.
    await page.goto(`/productos/${await idProducto('JOY-DSENSE-NG')}/edit`)
    const escalas = page.getByRole('region', { name: 'Precios por escala' }).first()
    await expect(escalas).toBeVisible()
    await capturar(escalas, 'precios-escalas', '01-bloque-escalas')
  })

  test('listados y pantallas principales', async ({ page }) => {
    await ingresar(page)
    for (const [guia, nombre, ruta] of LISTADOS) {
      await page.goto(ruta)
      await expect(page.getByRole('heading', { level: 1 }).first(), `${ruta} no mostró su título`).toBeVisible({ timeout: 20_000 })
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(600)
      await capturar(page, guia, nombre)
    }
  })
})
