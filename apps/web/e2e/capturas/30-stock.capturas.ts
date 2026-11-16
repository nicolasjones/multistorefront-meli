import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { capturar, elegir as _elegir, ingresar, irA, leer, ocultar, quitarResaltados, resaltar, ANON, URL_API, DESTINO, type Rol } from './lib'

// Capturas del manual: Stock (movimientos, depósitos, lotes, inventario, planilla, faltantes, más vendidos),
// Ingreso de mercadería y Proveedores. Solo lectura: se abren y completan diálogos, pero nunca se confirman.
void _elegir

test.describe('Stock y compras', () => {
  test.skip(!URL_API || !ANON, 'Requiere SUPABASE_URL y SUPABASE_ANON_KEY.')
  test.setTimeout(150_000)
  test.use({ viewport: { width: 1440, height: 900 } })

  const dialogo = (page: Page) => page.getByRole('dialog')

  // Combo de MUI por nombre (con «*» de obligatorio) y opción por texto; si hay `escribir`, filtra antes de elegir.
  async function combo(page: Page, ambito: Page | Locator, nombre: RegExp, opcion: string | RegExp, escribir?: string) {
    const c = ambito.getByRole('combobox', { name: nombre }).first()
    await c.click()
    if (escribir) await c.fill(escribir)
    await page.getByRole('option', { name: opcion }).first().click()
  }
  // Captura una zona con margen (para que los recuadros numerados de los bordes no se corten).
  async function zona(page: Page, objetivo: Locator, guia: string, nombre: string, margen = 24, maxAlto = 5000) {
    const c = await objetivo.boundingBox()
    if (!c) throw new Error('zona: sin caja')
    const vp = page.viewportSize()!
    const x = Math.max(0, c.x - margen), y = Math.max(0, c.y - margen)
    const clip = { x, y, width: Math.min(vp.width - x, c.width + 2 * margen), height: Math.min(vp.height - y, c.height + 2 * margen, maxAlto) }
    mkdirSync(path.join(DESTINO, guia), { recursive: true })
    await page.screenshot({ path: path.join(DESTINO, guia, `${nombre}.png`), clip, animations: 'disabled', caret: 'hide' })
  }
  const hoy = () => new Date().toISOString().slice(0, 10)

  // ---------- Stock actual y movimientos ----------
  test('stock actual: filtros y estados', async ({ page }) => {
    await ingresar(page, 'admin')
    await irA(page, '/stock')
    await expect(page.getByLabel('Buscar por nombre o SKU')).toBeVisible()
    await page.getByRole('button', { name: 'Sin stock', exact: true }).click()
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(600)
    await resaltar(page, page.getByRole('button', { name: 'Sin stock', exact: true }), 1)
    await capturar(page, 'stock-movimientos', '02-filtro-sin-stock'); await quitarResaltados(page)

    await page.getByRole('button', { name: 'Stock bajo', exact: true }).click()
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(600)
    await resaltar(page, page.getByRole('button', { name: 'Stock bajo', exact: true }), 1)
    await capturar(page, 'stock-movimientos', '03-filtro-stock-bajo'); await quitarResaltados(page)

    await page.getByRole('button', { name: 'Todos', exact: true }).click()
    await page.getByLabel('Buscar por nombre o SKU').fill('PlayStation 5 Pro')
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(800)
    await resaltar(page, page.getByRole('button', { name: /Nuevo movimiento de PlayStation 5 Pro/ }), 1)
    await resaltar(page, page.getByRole('button', { name: /Editar mínimo de PlayStation 5 Pro/ }), 2)
    await capturar(page, 'stock-movimientos', '04-botones-por-producto'); await quitarResaltados(page)
  })

  async function abrirMovimiento(page: Page, tipo: 'Entrada' | 'Salida' | 'Ajuste') {
    await irA(page, '/stock')
    await page.getByRole('button', { name: 'Nuevo movimiento', exact: true }).click()
    await expect(dialogo(page)).toBeVisible()
    await dialogo(page).getByRole('button', { name: tipo, exact: true }).click()
    await combo(page, dialogo(page), /^Producto/, /Alcohol isoprop/, 'Alcohol')
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(600)
  }

  test('nuevo movimiento: entrada, salida y ajuste', async ({ page }) => {
    await ingresar(page, 'deposito')
    await irA(page, '/stock')
    await resaltar(page, page.getByRole('button', { name: 'Nuevo movimiento', exact: true }).first(), 1)
    await capturar(page, 'stock-movimientos', '05-boton-nuevo-movimiento'); await quitarResaltados(page)

    for (const [tipo, cant, motivo, nombre, nota] of [
      ['Entrada', '12', /Compra a proveedor/, '06-entrada-completada', 'Mercadería del remito 0004-00018'],
      ['Salida', '3', /Rotura/, '07-salida-completada', 'Dos unidades rotas en el traslado'],
      ['Ajuste', '22', /Toma de inventario|Corrección|Ajuste/, '08-ajuste-completado', 'Conteo físico de la semana'],
    ] as const) {
      await abrirMovimiento(page, tipo)
      await dialogo(page).getByLabel(tipo === 'Ajuste' ? /Stock contado/ : /^Cantidad/).fill(cant)
      await combo(page, dialogo(page), /^Motivo/, motivo)
      await dialogo(page).getByLabel('Nota (opcional)').fill(nota)
      await page.waitForTimeout(400)
      await capturar(dialogo(page), 'stock-movimientos', nombre)
      await dialogo(page).getByRole('button', { name: 'Cancelar' }).click()
      await expect(dialogo(page)).toBeHidden()
    }
  })

  test('editar mínimo', async ({ page }) => {
    await ingresar(page, 'deposito')
    await irA(page, '/stock')
    await page.getByLabel('Buscar por nombre o SKU').fill('Vidrio templado')
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(800)
    await page.getByRole('button', { name: /Editar mínimo de Vidrio templado/ }).first().click()
    await expect(dialogo(page)).toBeVisible()
    await capturar(dialogo(page), 'stock-movimientos', '09-editar-minimo')
    await dialogo(page).getByRole('button', { name: 'Cancelar' }).click()
  })

  test('historial de movimientos filtrado', async ({ page }) => {
    await ingresar(page, 'admin')
    await irA(page, '/stock/movimientos')
    await combo(page, page, /Filtrar por producto/, /PlayStation 5 Pro/, 'PlayStation 5 Pro')
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(900)
    await ocultar(page.getByText(/Reserva comprobante/))
    await resaltar(page, page.getByRole('combobox', { name: /Filtrar por producto/ }), 1)
    await capturar(page, 'stock-movimientos', '10-historial-filtrado'); await quitarResaltados(page)
  })

  test('rol consulta no ve botones', async ({ page }) => {
    await ingresar(page, 'consulta')
    await irA(page, '/stock')
    await page.getByLabel('Buscar por nombre o SKU').fill('PlayStation 5 Pro')
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(900)
    await expect(page.getByText('PlayStation 5 Pro 2TB').first()).toBeVisible()
    await capturar(page, 'stock-movimientos', '11-rol-consulta')
  })

  // ---------- Depósitos y reservas ----------
  test('depósitos: alta, edición, por defecto', async ({ page }) => {
    await ingresar(page, 'admin')
    await irA(page, '/stock/depositos')
    await expect(page.getByRole('button', { name: 'Editar Depósito principal' })).toBeVisible({ timeout: 20_000 })
    await resaltar(page, page.getByRole('button', { name: 'Nuevo depósito de mercadería' }), 1)
    await capturar(page, 'stock-depositos-y-reservas', '01-boton-nuevo-deposito'); await quitarResaltados(page)

    await page.getByRole('button', { name: 'Nuevo depósito de mercadería' }).click()
    await expect(dialogo(page)).toBeVisible()
    await dialogo(page).getByLabel(/^Nombre/).fill('Depósito Rosario')
    await dialogo(page).getByLabel(/^Dirección/).fill('Bv. Oroño 1450, Rosario')
    await page.waitForTimeout(500)
    await capturar(dialogo(page), 'stock-depositos-y-reservas', '02-nuevo-deposito')
    await dialogo(page).getByRole('button', { name: 'Cancelar' }).click()
    await expect(dialogo(page)).toBeHidden()

    await page.getByRole('button', { name: 'Editar Depósito principal' }).click()
    await expect(dialogo(page)).toBeVisible()
    await page.waitForTimeout(500)
    await capturar(dialogo(page), 'stock-depositos-y-reservas', '03-editar-deposito')
    await dialogo(page).getByRole('button', { name: 'Cancelar' }).click()
    await expect(dialogo(page)).toBeHidden()

    await resaltar(page, page.getByRole('button', { name: /^Usar .* por defecto$/ }).first(), 1)
    await resaltar(page, page.getByLabel('Activo: Depósito principal'), 2)
    await capturar(page, 'stock-depositos-y-reservas', '04-por-defecto-y-activo'); await quitarResaltados(page)
  })

  test('stock actual: selector de depósito y reserva a pedido', async ({ page }) => {
    await ingresar(page, 'admin')
    await irA(page, '/stock')
    await page.getByRole('combobox', { name: /Depósito de mercadería/ }).click()
    await resaltar(page, page.getByRole('listbox'), 1)
    await capturar(page, 'stock-depositos-y-reservas', '05-selector-deposito'); await quitarResaltados(page)
    await page.getByRole('option', { name: /Local Corrientes/ }).click()
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(900)
    await capturar(page, 'stock-depositos-y-reservas', '06-stock-de-un-deposito')

    await page.getByRole('combobox', { name: /Depósito de mercadería/ }).click()
    await page.getByRole('option', { name: 'Todos los depósitos' }).click()
    await page.getByLabel('Buscar por nombre o SKU').fill('PlayStation 5 Pro')
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(900)
    const fila = page.getByRole('row', { name: /PlayStation 5 Pro/ }).first()
    await expect(fila).toBeVisible()
    await resaltar(page, fila, 1)
    await capturar(page, 'stock-depositos-y-reservas', '07-reserva-a-pedido'); await quitarResaltados(page)
  })

  test('trasladar: sin stock suficiente', async ({ page }) => {
    await ingresar(page, 'deposito')
    await irA(page, '/stock')
    await page.getByLabel('Buscar por nombre o SKU').fill('PlayStation 5 Pro')
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(800)
    await page.getByRole('button', { name: /Trasladar PlayStation 5 Pro/ }).first().click()
    await expect(dialogo(page)).toBeVisible()
    await combo(page, dialogo(page), /^Depósito de origen/, /Depósito principal/)
    await combo(page, dialogo(page), /^Depósito de destino/, /Local Corrientes/)
    await dialogo(page).getByLabel(/^Cantidad/).fill('3')
    await page.waitForTimeout(700)
    await capturar(dialogo(page), 'stock-depositos-y-reservas', '08-traslado-sin-stock')
    await dialogo(page).getByRole('button', { name: 'Cancelar' }).click()
  })

  // ---------- Lotes e inventario ----------
  test('carga en lote', async ({ page }) => {
    await ingresar(page, 'deposito')
    await irA(page, '/stock/lote')
    const form = page.getByRole('form', { name: 'Carga en lote' })
    await form.getByRole('textbox', { name: 'Proveedor' }).fill('Accesorios del Plata S.A.')
    await combo(page, form, /^Motivo/, /Compra a proveedor/)
    await combo(page, form, /^Producto 1/, /Vidrio templado 9H/, 'Vidrio')
    await form.getByLabel('Cantidad 1').fill('20')
    await form.getByRole('button', { name: 'Agregar producto' }).click()
    await combo(page, form, /^Producto 2/, /Auricular gamer/, 'Auricular gamer')
    await form.getByLabel('Cantidad 2').fill('10')
    await form.getByRole('button', { name: 'Agregar producto' }).click()
    await combo(page, form, /^Producto 3/, /Cable/, 'Cable')
    await form.getByLabel('Cantidad 3').fill('15')
    await page.waitForTimeout(500)
    await zona(page, form, 'stock-lotes-e-inventario', '01-lote-completado')
    await resaltar(page, form.getByRole('button', { name: 'Agregar producto' }), 1)
    await resaltar(page, form.getByRole('button', { name: 'Confirmar' }), 2)
    await zona(page, form, 'stock-lotes-e-inventario', '02-lote-pasos'); await quitarResaltados(page)

    const hist = page.getByRole('table', { name: 'Historial de lotes' })
    await expect(hist).toBeVisible()
    await hist.scrollIntoViewIfNeeded()
    await capturar(page.getByRole('heading', { name: 'Historial de lotes' }).locator('xpath=..'), 'stock-lotes-e-inventario', '03-historial-lotes')
  })

  test('toma de inventario', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1250 })
    await ingresar(page, 'operador')
    await irA(page, '/stock/toma-inventario')
    await expect(page.getByText('Elegí una categoría').first()).toBeVisible({ timeout: 20_000 })
    await page.getByRole('combobox', { name: /Categoría/ }).click()
    await page.waitForTimeout(400)
    const opciones = page.getByRole('option')
    await expect(opciones.first()).toBeVisible({ timeout: 15_000 })
    const n = await opciones.count()
    console.log('categorias:', await opciones.allInnerTexts())
    expect(n).toBeGreaterThan(0)
    // Elegimos una categoría con pocos productos (si existe «Celulares»/«Accesorios», se usa; si no, la primera)
    const pref = page.getByRole('option', { name: /Joysticks/ }).first()
    if (await pref.count()) await pref.click(); else await opciones.first().click()
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(900)
    const tabla = page.getByRole('table', { name: 'Productos de la toma de inventario' })
    await expect(tabla).toBeVisible()
    await capturar(page, 'stock-lotes-e-inventario', '04-toma-categoria')

    const cajas = tabla.getByRole('textbox')
    const filas = await cajas.count()
    const vistas = Math.min(filas, 3)
    for (let i = 0; i < vistas; i++) {
      const sistema = Number((await tabla.getByRole('row').nth(i + 1).getByRole('cell').nth(1).innerText()).trim()) || 0
      if (i === 1) continue
      await cajas.nth(i).fill(String(Math.max(0, sistema + (i === 0 ? 2 : -3))))
    }
    await page.waitForTimeout(500)
    await resaltar(page, cajas.first(), 1)
    await resaltar(page, page.getByRole('button', { name: 'Confirmar' }), 2)
    await capturar(page, 'stock-lotes-e-inventario', '05-toma-contados-diferencias'); await quitarResaltados(page)
  })

  test('lote y toma con rol consulta', async ({ page }) => {
    await ingresar(page, 'consulta')
    await irA(page, '/stock/lote')
    await expect(page.getByText('Tu rol puede ver el historial, pero no registrar lotes de stock.')).toBeVisible()
    await capturar(page, 'stock-lotes-e-inventario', '06-lote-rol-consulta')
  })

  // ---------- Planilla, exportar, faltantes, más vendidos ----------
  test('actualizar por Excel: vista previa sin aplicar', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1100 })
    await ingresar(page, 'admin')
    await irA(page, '/stock/excel')
    await expect(page.getByRole('button', { name: 'Descargar plantilla Excel' })).toBeVisible()
    await resaltar(page, page.getByRole('button', { name: 'Descargar plantilla Excel' }), 1)
    await resaltar(page, page.getByText('Elegir Excel').first(), 2)
    await capturar(page, 'stock-carga-exportacion-y-avisos', '01-planilla-inicio'); await quitarResaltados(page)

    const { default: escribir } = await import('write-excel-file/node')
    const filas = [
      ['sku', 'cantidad', 'motivo'],
      ['CEL-VIDRIO-9H', 45, 'Conteo inicial'],
      ['AUD-GAMER-71', 60, 'Conteo inicial'],
      ['CON-PS5-PRO', 2, 'Conteo inicial'],
      ['XXX-NO-EXISTE', 5, ''],
    ].map((f, i) => f.map((v) => (i === 0 ? { value: v, fontWeight: 'bold' as const } : { value: v === '' ? undefined : v })))
    const buffer = await escribir(filas as never, {} as never).toBuffer()
    await page.locator('input[type=file]').setInputFiles({ name: 'stock-inicial.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer })
    await expect(page.getByRole('table', { name: 'Diferencias a aplicar' })).toBeVisible({ timeout: 20_000 })
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(800)
    await page.getByRole('heading', { name: /Diferencias a aplicar/ }).scrollIntoViewIfNeeded()
    await page.evaluate(() => window.scrollBy(0, 120))
    await page.waitForTimeout(400)
    await capturar(page, 'stock-carga-exportacion-y-avisos', '02-planilla-vista-previa')
    await resaltar(page, page.getByRole('button', { name: /^Aplicar/ }), 1)
    await resaltar(page, page.getByRole('button', { name: 'Cancelar' }), 2)
    await capturar(page, 'stock-carga-exportacion-y-avisos', '03-planilla-aplicar-o-cancelar'); await quitarResaltados(page)
    await page.getByRole('button', { name: 'Cancelar' }).click()
  })

  test('exportar, faltantes y más vendidos', async ({ page }) => {
    await ingresar(page, 'admin')
    await irA(page, '/stock')
    await resaltar(page, page.getByRole('button', { name: /Exportar/ }).first(), 1)
    await capturar(page, 'stock-carga-exportacion-y-avisos', '04-exportar-stock'); await quitarResaltados(page)

    await irA(page, '/stock/faltantes')
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(800)
    await capturar(page, 'stock-carga-exportacion-y-avisos', '05-faltantes')
    const marca = page.getByRole('checkbox').nth(1)
    if (await marca.count()) {
      await marca.check()
      const avisar = page.getByRole('button', { name: /Avisar a los seleccionados/ })
      await resaltar(page, avisar, 1)
      await capturar(page, 'stock-carga-exportacion-y-avisos', '06-faltantes-seleccion'); await quitarResaltados(page)
      await avisar.click()
      await expect(dialogo(page)).toBeVisible()
      await capturar(dialogo(page), 'stock-carga-exportacion-y-avisos', '07-faltantes-avisar')
      await dialogo(page).getByRole('button', { name: 'Cancelar' }).click()
    }

    await irA(page, '/stock/mas-vendidos')
    await page.getByRole('button', { name: 'Últimos 90 días' }).click()
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(1000)
    await resaltar(page, page.getByRole('group', { name: 'Atajos de período' }), 1)
    await capturar(page, 'stock-carga-exportacion-y-avisos', '08-mas-vendidos'); await quitarResaltados(page)
  })

  // ---------- Ingreso de mercadería ----------
  async function ocultarEpica(page: Page) { await ocultar(page.getByText(/épica/i)) }

  test('ingreso: formulario vacío y completo', async ({ page }) => {
    await ingresar(page, 'admin')
    await page.setViewportSize({ width: 1440, height: 1000 })
    await irA(page, '/stock/ingresos')
    await ocultarEpica(page)
    const form = page.locator('form').filter({ has: page.getByLabel('Remito o factura de compra') }).first()
    await expect(form).toBeVisible()

    await combo(page, form, /^Compra a nombre de/, /San Javucho/)
    await combo(page, form, /^Proveedor/, /Distribuidora Gamer Norte/)
    await form.getByLabel('Remito o factura de compra').fill('A-0004-00006711')
    await combo(page, form, /^Producto 1/, /Joystick|Control|Auricular/, 'Auricular')
    await form.getByLabel('Costo unit. USD').first().fill('14.5')
    await form.getByLabel('Cantidad').first().fill('24')
    await form.getByRole('button', { name: 'Agregar producto' }).click()
    await combo(page, form, /^Producto 2/, /Vidrio/, 'Vidrio')
    await form.getByLabel('Cantidad').nth(1).fill('50')
    await form.getByLabel('Costo unit. USD').nth(1).fill('1.8')
    await form.getByRole('button', { name: 'Agregar producto' }).click()
    await combo(page, form, /^Producto 3/, /Cable/, 'Cable')
    await form.getByLabel('Cantidad').nth(2).fill('30')
    await form.getByLabel('Costo unit. USD').nth(2).fill('2.3')
    await page.waitForTimeout(600)
    await ocultarEpica(page)
    await zona(page, form, 'ingreso-de-mercaderia', '03-formulario-varias-lineas')

    const costo = form.getByLabel('Actualizar el costo del producto con este ingreso')
    if (await costo.count()) {
      await costo.check()
      await resaltar(page, form.getByText('Actualizar el costo del producto con este ingreso'), 1)
      await resaltar(page, form.getByRole('button', { name: 'Registrar ingreso' }), 2)
      await zona(page, form, 'ingreso-de-mercaderia', '04-costo-y-registrar'); await quitarResaltados(page)
    }
  })

  test('ingreso: historial, filtros, anulado y diálogo Anular', async ({ page }) => {
    await ingresar(page, 'admin')
    await page.setViewportSize({ width: 1440, height: 1600 })
    await irA(page, '/stock/ingresos')
    await ocultarEpica(page)
    const hist = page.getByRole('heading', { name: 'Ingresos de mercadería', level: 2 }).locator('xpath=../..')
    await expect(hist).toBeVisible()
    await hist.getByLabel('Desde').fill('2026-08-15')
    await hist.getByLabel('Hasta').fill('2026-08-31')
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(900)
    await ocultarEpica(page)
    await hist.scrollIntoViewIfNeeded()
    await page.evaluate(() => window.scrollBy(0, 0))
    await page.waitForTimeout(300)
    await resaltar(page, hist.getByLabel('Desde'), 1)
    await resaltar(page, hist.getByLabel('Hasta'), 2)
    await resaltar(page, hist.getByRole('combobox', { name: 'Proveedor' }), 3)
    await resaltar(page, hist.getByRole('group', { name: 'Filtrar por tienda' }), 4)
    await zona(page, hist, 'ingreso-de-mercaderia', '05-historial-filtros', 24, 560); await quitarResaltados(page)

    await combo(page, hist, /^Proveedor/, /TecnoParts/, 'TecnoParts')
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(900)
    await ocultarEpica(page)
    await expect(hist.getByText('Anulado', { exact: true }).first()).toBeVisible()
    await hist.scrollIntoViewIfNeeded()
    await zona(page, hist, 'ingreso-de-mercaderia', '06-ingreso-anulado')

    await hist.getByLabel('Desde').fill(''); await hist.getByLabel('Hasta').fill('')
    const limpiar = hist.getByRole('button', { name: 'Limpiar filtros' })
    if (await limpiar.isEnabled()) await limpiar.click()
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(900)
    const btn = page.getByRole('button', { name: 'Anular', exact: true }).first()
    await expect(btn).toBeVisible()
    await btn.click()
    await expect(dialogo(page)).toBeVisible()
    await dialogo(page).getByLabel('Motivo de la anulación').fill('Cargué la mercadería en el proveedor equivocado')
    await page.waitForTimeout(400)
    await capturar(dialogo(page), 'ingreso-de-mercaderia', '07-dialogo-anular')
    await dialogo(page).getByRole('button', { name: 'Cancelar' }).click()
  })

  test('ingreso: archivo anterior y rol depósito/consulta', async ({ page, browser }) => {
    await ingresar(page, 'admin')
    await irA(page, '/stock/ingresos')
    await page.getByRole('tab', { name: 'Archivo anterior al sistema' }).click()
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(900)
    await resaltar(page, page.getByRole('tab', { name: 'Archivo anterior al sistema' }), 1)
    await capturar(page, 'ingreso-de-mercaderia', '08-archivo-anterior'); await quitarResaltados(page)

    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'es-AR' })
    const p2 = await ctx.newPage()
    await ingresar(p2, 'consulta')
    await irA(p2, '/stock/ingresos')
    await p2.waitForLoadState('networkidle')
    await ocultarEpica(p2)
    await capturar(p2, 'ingreso-de-mercaderia', '09-rol-consulta')
    await ctx.close()
  })

  // ---------- Proveedores ----------
  test('proveedores: listado, filtro, alta y ficha', async ({ page }) => {
    await ingresar(page, 'admin')
    await irA(page, '/proveedores')
    await expect(page.getByText('Distribuidora Gamer Norte').first()).toBeVisible()
    await page.getByRole('button', { name: 'Mundo JC', exact: true }).click()
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(900)
    await resaltar(page, page.getByRole('group', { name: 'Filtrar por tienda' }), 1)
    await capturar(page, 'proveedores', '02-filtro-tienda'); await quitarResaltados(page)
    await page.getByRole('button', { name: 'Todas las tiendas' }).click()
    await page.waitForLoadState('networkidle')

    await resaltar(page, page.getByRole('button', { name: 'Nuevo proveedor' }).first(), 1)
    await capturar(page, 'proveedores', '03-boton-nuevo-proveedor'); await quitarResaltados(page)
    await page.getByRole('button', { name: 'Nuevo proveedor' }).first().click()
    await expect(dialogo(page)).toBeVisible()
    const d = dialogo(page)
    await d.getByLabel(/^Razón social/).fill('Distribuidora Litoral S.R.L.')
    await d.getByLabel(/^CUIT/).fill('30-71234567-3')
    await d.getByLabel('Persona de contacto').fill('Marcela Ibáñez')
    await d.getByLabel('Correo').fill('compras@litoral.example.com')
    await d.getByLabel('Teléfono').fill('011 4555-0123')
    await d.getByLabel('Dirección').fill('Av. San Martín 2250, Rosario')
    await page.waitForTimeout(500)
    await capturar(d, 'proveedores', '04-alta-proveedor')
    await d.getByRole('button', { name: 'Cancelar' }).click()
    await expect(d).toBeHidden()

    // Ficha de un proveedor con productos vinculados.
    const prov = await leer<{ id: string }>('admin', 'proveedores?select=id&razon_social=ilike.*Gamer Norte*', 'dominio')
    await irA(page, `/proveedores/show/${prov[0].id}`)
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(900)
    await capturar(page, 'proveedores', '05-ficha')
    await page.getByRole('button', { name: 'Enviar correo' }).click()
    await expect(dialogo(page)).toBeVisible()
    await dialogo(page).getByLabel('Asunto').fill('Consulta de precios y disponibilidad')
    await dialogo(page).getByLabel('Mensaje').fill('Hola, ¿podrían pasarnos la lista de precios actualizada y los plazos de entrega? Gracias.')
    await page.waitForTimeout(400)
    await capturar(dialogo(page), 'proveedores', '06-enviar-correo')
    await dialogo(page).getByRole('button', { name: 'Cancelar' }).click()
  })

  test('proveedores: importar (solo botón) y rol consulta', async ({ page }) => {
    await ingresar(page, 'admin')
    await irA(page, '/proveedores')
    const imp = page.getByRole('link', { name: 'Importar' }).or(page.getByRole('button', { name: 'Importar' })).first()
    if (await imp.count()) {
      void imp
    }
  })
})

void (null as unknown as Rol)
