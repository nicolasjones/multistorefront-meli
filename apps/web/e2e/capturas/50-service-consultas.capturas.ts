import { expect, test, type Page } from '@playwright/test'
import { capturar, elegir, ingresar, irA, ocultar, quitarResaltados, resaltar } from './lib'

// Capturas de Servicio técnico, Consultas, Avisos y listas, y Migración inicial de datos. Solo lectura: los
// formularios y diálogos se completan pero nunca se confirman.
test.describe.configure({ mode: 'serial' })
test.setTimeout(150_000)

const SVC = 'service-tecnico'
const REP = 'service-repuestos-y-stock'

async function listado(page: Page) {
  await irA(page, '/service-tecnico/reparaciones')
  await expect(page.getByRole('link', { name: /^R-\d+/ }).first()).toBeVisible()
}

// Abre la ficha de la primera reparación con el estado indicado (en cualquier período, buscando por serie no hace falta).
async function abrirReparacion(page: Page, estado?: RegExp) {
  await listado(page)
  if (estado && /Entregado|Anulad/.test(estado.source)) {
    await page.getByLabel('Buscar por N.º de serie').fill('0')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1200)
  }
  const filas = page.getByRole('row').filter({ has: page.getByRole('link', { name: /^R-\d+/ }) })
  const fila = estado ? filas.filter({ hasText: estado }).first() : filas.first()
  await expect(fila).toBeVisible()
  await fila.getByRole('link', { name: /^R-\d+/ }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Cliente y equipo' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(500)
}

test('listado: filtros', async ({ page }) => {
  await ingresar(page, 'operador')
  await listado(page)
  await page.getByRole('button', { name: 'Semana' }).click()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(600)
  await resaltar(page, page.getByRole('group', { name: 'Período de entrega prevista' }), 1)
  await capturar(page, SVC, '02-filtro-semana')
  await quitarResaltados(page)
  await page.getByRole('button', { name: 'Mes' }).click()
  await page.waitForLoadState('networkidle')
  // Por técnico
  await page.getByRole('combobox', { name: 'Técnico' }).click()
  const opciones = page.getByRole('option')
  await expect(opciones.nth(1)).toBeVisible()
  await opciones.nth(1).click()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(600)
  await capturar(page, SVC, '04-filtrado-por-tecnico')
})

test('listado: búsqueda por serie', async ({ page }) => {
  await ingresar(page, 'operador')
  await listado(page)
  const serie = await page.getByRole('row').filter({ has: page.getByRole('link', { name: /^R-\d+/ }) })
    .evaluateAll((filas) => filas.map((f) => (f.querySelectorAll('td')[4]?.textContent ?? '').trim()).find((t) => t && t !== '—') ?? '')
  expect(serie).not.toBe('')
  const buscador = page.getByLabel('Buscar por N.º de serie')
  await buscador.fill(serie.slice(0, Math.max(4, serie.length - 2)))
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(900)
  await resaltar(page, buscador, 1)
  await capturar(page, SVC, '05-busqueda-por-serie')
})

test('nueva reparación completada', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await ingresar(page, 'operador')
  await listado(page)
  await resaltar(page, page.getByRole('link', { name: 'Nueva reparación' }), 1)
  await quitarResaltados(page)
  await page.getByRole('link', { name: 'Nueva reparación' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Nueva reparación' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  const cliente = page.getByRole('combobox', { name: /Cliente/ }).first()
  await cliente.click()
  await cliente.fill('a')
  await page.getByRole('option').first().click()
  await page.getByRole('textbox', { name: 'Contacto' }).fill('11 5555-0123')
  await elegir(page, 'Consola o equipo', /./)
  await elegir(page, 'Modelo', /./)
  await page.getByLabel('N.º de serie').fill('XKW40012345')
  await page.getByLabel('Accesorios recibidos').fill('Cargador original y funda')
  await page.getByLabel('Falla informada').fill('No enciende; el cliente dice que se apagó mientras cargaba.')
  const tecnico = page.getByRole('combobox', { name: 'Técnico' })
  if (await tecnico.count()) { await tecnico.first().click(); await page.getByRole('option').nth(1).click() }
  const entrega = page.getByLabel('Entrega prevista')
  await entrega.click()
  await entrega.pressSequentially('15112026')
  await page.waitForTimeout(400)
  await capturar(page, SVC, '07-nueva-reparacion')
})

test('detalle: estado, ítems y diálogos', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1400 })
  await ingresar(page, 'operador')
  await abrirReparacion(page, /Recibido|En diagn|En reparaci|Esperando/)
  await capturar(page, SVC, '08-detalle-reparacion')
  const items = page.getByRole('heading', { name: 'Mano de obra y repuestos' }).locator('xpath=ancestor::*[contains(@class,"MuiCard-root")][1]')
  await capturar(items, REP, '01-items-con-repuestos')
  await resaltar(page, page.getByRole('combobox', { name: 'Estado' }), 1)
  await capturar(page, SVC, '10-cambiar-estado')
  await quitarResaltados(page)
  await page.getByRole('button', { name: 'Agregar repuesto' }).click()
  const dlg = page.getByRole('dialog')
  await expect(dlg).toBeVisible()
  const prod = dlg.getByLabel('Buscar producto del catálogo')
  await prod.fill('cable')
  await page.waitForTimeout(1200)
  const op = page.getByRole('option').first()
  if (await op.count()) await op.click()
  await dlg.getByLabel('Precio').fill('18500')
  await dlg.getByLabel('Cantidad').fill('1')
  await capturar(dlg, SVC, '11-agregar-repuesto')
  await capturar(dlg, REP, '02-dialogo-agregar-repuesto')
  await dlg.getByRole('button', { name: 'Cancelar' }).click()
  await expect(dlg).toBeHidden()
  await page.getByRole('button', { name: 'Agregar mano de obra' }).click()
  await expect(dlg).toBeVisible()
  await dlg.getByLabel('Concepto').fill('Cambio de pantalla')
  await dlg.getByLabel('Precio').fill('25000')
  await dlg.getByLabel('Cantidad').fill('1')
  await capturar(dlg, SVC, '12-agregar-mano-de-obra')
  await dlg.getByRole('button', { name: 'Cancelar' }).click()
  await expect(dlg).toBeHidden()
  // Entrega: se elige el estado que cierra
  await page.getByRole('combobox', { name: 'Estado' }).click()
  await page.getByRole('option', { name: /^Entregado/ }).click()
  await expect(dlg).toBeVisible()
  await dlg.getByLabel('Quién entregó').fill('Marcos Benítez')
  await capturar(dlg, SVC, '13-registrar-entrega')
  await dlg.getByRole('button', { name: 'Cancelar' }).click()
  await expect(dlg).toBeHidden()
  await page.getByRole('button', { name: 'Anular', exact: true }).click()
  await expect(dlg).toBeVisible()
  await dlg.getByLabel('Motivo de la anulación').fill('El cliente retiró el equipo sin reparar.')
  await capturar(dlg, SVC, '14-anular-reparacion')
  await dlg.getByRole('button', { name: 'Cancelar' }).click()
})

test('reparación entregada, orden e informes por rol', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1280, height: 1400 })
  await ingresar(page, 'operador')
  await abrirReparacion(page, /Entregado/)
  await capturar(page, SVC, '15-reparacion-entregada')
  const ficha = page.url()
  await page.setViewportSize({ width: 1280, height: 1120 })
  await page.getByRole('link', { name: 'Imprimir remito' }).click()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(800)
  await capturar(page, SVC, '16-remito-de-entrega')
  await page.goto(ficha.replace(/\/$/, '') + '/orden')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(800)
  await capturar(page, SVC, '17-orden-de-ingreso')
})

test('modelos y estados', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1150 })
  await ingresar(page, 'operador')
  await irA(page, '/service-tecnico/modelos')
  await page.waitForTimeout(500)
  await capturar(page, SVC, '18-modelos')
  await page.getByRole('button', { name: 'Nuevo modelo' }).click()
  const dlg = page.getByRole('dialog')
  await dlg.getByLabel('Equipo').fill('Nintendo Switch')
  await dlg.getByLabel('Modelo').fill('Switch OLED')
  await dlg.getByLabel('Mano de obra base').fill('30000')
  await capturar(dlg, SVC, '19-nuevo-modelo')
  await dlg.getByRole('button', { name: 'Cancelar' }).click()
  await irA(page, '/service-tecnico/estados')
  await page.waitForTimeout(500)
  await capturar(page, SVC, '20-estados-de-reparacion')
  await page.getByRole('button', { name: 'Nuevo estado' }).click()
  await dlg.getByLabel('Nombre').fill('Presupuesto aprobado')
  await dlg.getByLabel('Qué significa').fill('El cliente aceptó el presupuesto y se puede empezar.')
  await capturar(dlg, SVC, '21-nuevo-estado')
  await dlg.getByRole('button', { name: 'Cancelar' }).click()
})

test('costos y solo lectura según rol', async ({ browser }) => {
  for (const [rol, nombre] of [['admin', '03-costo-interno-con-permiso'], ['mostrador', '04-items-solo-lectura']] as const) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1600 }, locale: 'es-AR' })
    const page = await ctx.newPage()
    await ingresar(page, rol)
    await abrirReparacion(page, /En reparaci|Recibido|En diagn|Esperando/)
    const titulo = rol === 'admin' ? 'Costo interno' : 'Mano de obra y repuestos'
    const tarjeta = page.getByRole('heading', { name: titulo }).locator('xpath=ancestor::*[contains(@class,"MuiCard-root")][1]')
    await expect(tarjeta).toBeVisible()
    await capturar(tarjeta, REP, nombre)
    await ctx.close()
  }
})

// ---------------------------------------------------------------- Consultas
const CON = 'consultas'

async function bandeja(page: Page) {
  await irA(page, '/consultas')
  await expect(page.getByRole('button', { name: /^Abrir la consulta de/ }).first()).toBeVisible()
}

async function abrirConsulta(page: Page, filtro: { hasText: string | RegExp }) {
  const fila = page.getByRole('row').filter({ has: page.getByRole('button', { name: /^Abrir la consulta de/ }) }).filter(filtro).first()
  await expect(fila).toBeVisible()
  await fila.getByRole('button', { name: /^Abrir la consulta de/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(600)
}

test('consultas: filtros', async ({ page }) => {
  await ingresar(page, 'operador')
  await bandeja(page)
  await page.getByRole('button', { name: /^Nuevas/ }).click()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(700)
  await resaltar(page, page.getByRole('group', { name: 'Filtrar por estado' }), 1)
  await capturar(page, CON, '02-filtro-nuevas')
  await quitarResaltados(page)
  await page.getByRole('button', { name: 'Resuelta' }).click()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(700)
  await capturar(page, CON, '03-filtro-resueltas')
  await page.getByRole('button', { name: 'Todas', exact: true }).click()
  await page.waitForTimeout(500)
  const pildora = page.getByRole('button', { name: 'San Javucho', exact: true }).last()
  await pildora.click()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(800)
  await resaltar(page, pildora, 1)
  await capturar(page, CON, '04-filtro-tienda')
})

test('consultas: detalle', async ({ page }) => {
  await ingresar(page, 'operador')
  await bandeja(page)
  await abrirConsulta(page, { hasText: 'Formulario' })
  await capturar(page.getByRole('dialog'), CON, '05-detalle-formulario')
  await page.keyboard.press('Escape')
  await abrirConsulta(page, { hasText: 'WhatsApp' })
  await capturar(page.getByRole('dialog'), CON, '06-detalle-whatsapp')
  await page.keyboard.press('Escape')
  await abrirConsulta(page, { hasText: 'Resuelta' })
  await capturar(page.getByRole('dialog'), CON, '07-consulta-resuelta')
})

// ---------------------------------------------------------------- Avisos y listas
const AVI = 'avisos-y-listas'

test('avisos por correo', async ({ page }) => {
  await ingresar(page, 'operador')
  await irA(page, '/cuenta/avisos')
  await page.waitForTimeout(500)
  await capturar(page, AVI, '01-avisos-por-correo')
})

test('listas del administrador', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await ingresar(page, 'admin')
  await irA(page, '/configuracion/listas')
  await expect(page.getByRole('button', { name: 'Nuevo motivo' })).toBeVisible()
  await capturar(page, AVI, '02-listas-configurables')
  await page.getByRole('button', { name: 'Nuevo motivo' }).click()
  const dlg = page.getByRole('dialog')
  await expect(dlg).toBeVisible()
  await dlg.getByLabel('Nombre').fill('Rotura en depósito')
  await capturar(dlg, AVI, '03-nuevo-motivo-de-stock')
  await dlg.getByRole('button', { name: 'Cancelar' }).click()
  await expect(dlg).toBeHidden()
  const sec = page.locator('section[aria-labelledby="lista-estados-consulta"]')
  await sec.scrollIntoViewIfNeeded()
  await capturar(sec, AVI, '09-estados-de-consulta')
  await page.getByRole('button', { name: 'Nuevo estado' }).click()
  await dlg.getByLabel('Nombre').fill('Esperando respuesta del cliente')
  await capturar(dlg, AVI, '04-nuevo-estado-de-consulta')
  await dlg.getByRole('button', { name: 'Cancelar' }).click()
})

test('formas de pago y de envío', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1150 })
  await ingresar(page, 'admin')
  await irA(page, '/ventas/configuracion')
  await page.waitForTimeout(800)
  await capturar(page, AVI, '05-formas-de-pago')
  await page.getByRole('button', { name: 'Nueva forma de pago' }).click()
  const dlg = page.getByRole('dialog')
  await expect(dlg).toBeVisible()
  await dlg.getByLabel('Nombre').fill('Mercado Pago (link de pago)')
  await capturar(dlg, AVI, '06-nueva-forma-de-pago')
  await dlg.getByRole('button', { name: 'Cancelar' }).click()
  await expect(dlg).toBeHidden()
  await page.getByRole('tab', { name: 'Formas de envío' }).click()
  await page.waitForTimeout(800)
  await capturar(page, AVI, '07-formas-de-envio')
})

test('motivos de movimiento de stock', async ({ page }) => {
  await ingresar(page, 'admin')
  await irA(page, '/stock/motivos')
  await page.waitForTimeout(600)
  await capturar(page, AVI, '08-motivos-de-movimiento')
})

// ---------------------------------------------------------------- Migración inicial de datos
const MIG = 'migracion-inicial-de-datos'

test('migración: importar y proveedores', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await ingresar(page, 'admin')
  await irA(page, '/migracion/importar/clientes')
  await page.waitForTimeout(600)
  await capturar(page, MIG, '01-importar-clientes')
  await resaltar(page, page.getByRole('button', { name: /Descargar plantilla CSV/ }), 1)
  await capturar(page, MIG, '02-descargar-plantilla')
  await quitarResaltados(page)
  await irA(page, '/migracion/importar/proveedores')
  await page.waitForTimeout(600)
  await capturar(page, MIG, '03-importar-proveedores')
  await irA(page, '/migracion/importar/vinculos-proveedor-producto')
  await page.waitForTimeout(600)
  await capturar(page, MIG, '04-importar-vinculos')
  await irA(page, '/migracion/importar/ingresos_archivo')
  await page.waitForTimeout(600)
  await capturar(page, MIG, '08-importar-ingresos-anteriores')
})

test('migración: informes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await ingresar(page, 'admin')
  await irA(page, '/migracion/informes')
  await page.waitForTimeout(800)
  await capturar(page, MIG, '05-informes-de-conciliacion')
  const ver = page.getByText('Ver informe').first()
  if (await ver.count()) {
    await ver.click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)
    await capturar(page, MIG, '06-informe-de-una-carga')
  }
})

test('migración: rol sin permiso', async ({ page }) => {
  await ingresar(page, 'operador')
  await page.goto('/migracion/importar/clientes')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1200)
  await capturar(page, MIG, '07-sin-permiso')
})
