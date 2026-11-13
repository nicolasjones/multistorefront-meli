import { expect, test, type Page } from '@playwright/test'
import { capturar, elegir, ingresar, irA, leer, ocultar, quitarResaltados, resaltar, type Rol } from './lib'

// Catálogo, precios, tiendas y clientes. Solo lectura: se abren formularios y diálogos y se cierran sin confirmar.
const SJ = 'http://demo-sanjavucho.localhost:4300'
const JC = 'http://demo-mundojc.localhost:4300'

test.use({ actionTimeout: 8000 })
test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1440, height: 900 }) })

async function panel(page: Page, rol: Rol = 'admin') {
  await ingresar(page, rol)
  // Que la barra superior diga «Todas mis empresas» (la empresa activa se conserva entre sesiones).
  if (rol === 'admin') {
    await page.waitForLoadState('networkidle')
    const sel = page.getByRole('button', { name: /^Empresa activa:/ }).first()
    if (await sel.count() && !/Todas mis empresas/.test((await sel.getAttribute('aria-label')) ?? '')) {
      await sel.click()
      await page.getByRole('menuitem', { name: /Todas mis empresas/ }).click()
      await page.waitForLoadState('networkidle'); await page.waitForTimeout(800)
    }
  }
}

// La web demo se compiló sin la lista de hosts del panel, así que no reconoce las tiendas por dominio: se corrige
// solo en el navegador de la captura (no toca nada del servidor) para poder ver las tiendas públicas.
async function conTiendas(page: Page) {
  await page.route(/\/assets\/index-[^/]*\.js$/, async (route) => {
    const r = await route.fetch()
    const b = (await r.text()).replace('function YO(e=void 0,t=!0)', 'function YO(e=void 0,t=!1)')
    await route.fulfill({ response: r, body: b })
  })
}
async function abrirTienda(page: Page, base: string, ruta = '/') {
  await page.goto(base + ruta)
  await page.waitForLoadState('networkidle')
  await expect(page.getByText('Ingresar', { exact: true }).or(page.getByRole('button', { name: 'Ingresar' })).first()).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(800)
}

// Recorta una franja vertical de un contenedor (para formularios largos).
async function franja(page: Page, desde: number, hasta: number, guia: string, nombre: string, x = 240, ancho = 1180) {
  await page.evaluate(() => document.querySelectorAll('body *').forEach((e) => { const p = getComputedStyle(e).position; if ((p === 'fixed' || p === 'sticky') && !(e as HTMLElement).dataset.resaltado) (e as HTMLElement).style.visibility = 'hidden' }))
  await page.screenshot({ path: `/destino/${guia}/${nombre}.png`, fullPage: true, clip: { x, y: desde, width: ancho, height: hasta - desde }, animations: 'disabled', caret: 'hide' })
}
async function topDe(page: Page, texto: string | RegExp, nivel?: number) {
  const el = nivel ? page.getByRole('heading', { name: texto, level: nivel }).first() : page.getByText(texto, { exact: typeof texto === 'string' }).first()
  const b = await el.boundingBox()
  if (!b) throw new Error(`no se ve ${texto}`)
  return b.y + (await page.evaluate(() => window.scrollY))
}
const alto = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight)

// ───────────────────────── catalogo-productos ─────────────────────────
const G1 = 'catalogo-productos'
test('productos: búsqueda, inactivos y filtros', async ({ page }) => {
  await panel(page)
  await irA(page, '/productos')
  await page.getByLabel(/Buscar por nombre/).fill('joystick')
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(800)
  await resaltar(page, page.getByLabel(/Buscar por nombre/), 1)
  await capturar(page, G1, '01-busqueda'); await quitarResaltados(page)
  await page.getByRole('button', { name: 'Todos', exact: true }).first().click()
  await page.getByLabel('Disponibilidad').selectOption({ label: 'A pedido' })
  await page.getByLabel('Categoría').selectOption({ label: '— Joysticks' }).catch(() => {})
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(800)
  await capturar(page, G1, '02-disponibilidad')
})

test('productos: formulario de creación', async ({ page }) => {
  await panel(page)
  await irA(page, '/productos')
  await resaltar(page, page.getByRole('button', { name: 'Nuevo producto' }).or(page.getByRole('link', { name: 'Nuevo producto' })), 1)
  await capturar(page, G1, '04-boton-nuevo'); await quitarResaltados(page)
  await irA(page, '/productos/create')
  await page.getByLabel('Nombre', { exact: false }).first().fill('Joystick inalámbrico para Switch')
  await page.getByLabel('Descripción').fill('Joystick compatible con Nintendo Switch, batería de 20 horas.')
  await page.getByLabel('SKU').fill('JOY-SW-INAL')
  await page.getByLabel('Compatible con').fill('Switch, Switch OLED')
  await elegir(page, 'Proveedor', /Distribuidora/)
  await page.getByLabel('Código del proveedor').fill('NORTE-JOY-SW')
  await page.getByLabel(/Código de barras/).fill('7790000099991')
  await page.getByLabel(/Precio de lista/).fill('38')
  await page.getByLabel('Costo', { exact: true }).fill('26')
  await page.getByLabel('x5', { exact: false }).first().fill('36').catch(() => {})
  await elegir(page, 'Categoría', /Joysticks/)
  const sw = page.getByRole('switch')
  for (const i of [0, 1]) await sw.nth(i).check().catch(() => {})
  await page.waitForTimeout(500)
  const total = await alto(page)
  const yPrecio = await topDe(page, 'Precio y costo')
  const yEsc = await topDe(page, /Precios por escala/)
  const yImg = await topDe(page, 'Imágenes', 3).catch(() => topDe(page, 'Imágenes'))
  await franja(page, 70, yPrecio - 8, G1, '05-form-datos')
  await franja(page, yPrecio - 8, yEsc - 8, G1, '06-form-precio-costo')
  await franja(page, yEsc - 8, yImg - 8, G1, '07-form-escalas-disponibilidad')
  await franja(page, yImg - 8, total - 20, G1, '08-form-imagenes-empresas')
})

test('productos: edición y desactivar', async ({ page }) => {
  await panel(page)
  const p = await leer<{ id: string }>('admin', 'productos?select=id&id=eq.98facf37-a18c-4e12-a974-597f27dad302', 'dominio')
  await irA(page, `/productos/${p[0].id}/edit`)
  await expect(page.getByLabel('Nombre', { exact: false }).first()).not.toHaveValue('')
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(800)
  const yPrecio = await topDe(page, 'Precio y costo')
  const yDisp = await topDe(page, 'Disponibilidad')
  await franja(page, yPrecio - 8, yDisp - 8, G1, '09-edicion-precios-escalas')
  await page.evaluate(() => window.scrollTo(0, 0))
  await resaltar(page, page.getByRole('button', { name: /^Desactivar/ }), 1)
  await capturar(page, G1, '10-boton-desactivar'); await quitarResaltados(page)
})

test('categorías', async ({ page }) => {
  await panel(page)
  await irA(page, '/categorias')
  await page.getByRole('button', { name: 'Expandir todo' }).click().catch(() => {})
  await page.waitForTimeout(500)
  await capturar(page, G1, '12-categorias')
  await resaltar(page, page.getByRole('button', { name: 'Nueva categoría' }), 1)
  await capturar(page, G1, '13-boton-nueva-categoria'); await quitarResaltados(page)
  await page.getByRole('button', { name: 'Nueva categoría' }).click()
  const d = page.getByRole('dialog')
  await expect(d).toBeVisible()
  await d.getByLabel('Nombre').fill('Auriculares gamer')
  await page.waitForTimeout(500)
  await capturar(d, G1, '14-nueva-categoria')
  await d.getByRole('button', { name: 'Cancelar' }).click()
  await page.getByRole('button', { name: /Eliminar/ }).first().click().catch(() => {})
  if (await page.getByRole('dialog').count()) { await capturar(page.getByRole('dialog'), G1, '15-eliminar-categoria'); await page.getByRole('button', { name: 'Cancelar' }).click() }
})

// ───────────────────────── precios-dolar ─────────────────────────
const G2 = 'precios-dolar'
test('cotización: diálogo y historial', async ({ page }) => {
  await panel(page)
  await irA(page, '/cotizacion')
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(800)
  await capturar(page, G2, '01-vigente-historial')
  await resaltar(page, page.getByRole('button', { name: 'Cargar cotización' }), 1)
  await capturar(page, G2, '02-boton-cargar'); await quitarResaltados(page)
  await page.getByRole('button', { name: 'Cargar cotización' }).click()
  const d = page.getByRole('dialog')
  await expect(d).toBeVisible()
  await d.getByLabel(/Dólar del día/).fill('1210')
  await page.waitForTimeout(600)
  await capturar(d, G2, '03-formulario-valor')   // sin enviar: «Cargar dólar» deja una cotización pendiente
  await d.getByLabel(/Dólar del día/).fill('1700')
  await page.waitForTimeout(600)
  await capturar(d, G2, '04-variacion-inusual')
  await d.getByRole('button', { name: 'Cancelar' }).click()
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(300)
  await capturar(page, G2, '05-historial')
})

// ───────────────────────── precios-e-iva ─────────────────────────
const G3 = 'precios-e-iva'
test('precios: empresa, IVA y producto', async ({ page }) => {
  await panel(page)
  const emp = await leer<{ id: string; nombre: string }>('admin', 'empresas?select=id,nombre&order=nombre', 'dominio')
  const sj = emp.find((e) => e.nombre === 'San Javucho')!, jc = emp.find((e) => e.nombre === 'Mundo JC')!
  await irA(page, `/empresas/edit/${sj.id}/precios`)
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(1200)
  await capturar(page, G3, '01-precios-san-javucho')
  await page.getByRole('button', { name: 'Central con ajuste' }).click()
  await page.getByLabel(/Ajuste sobre el precio central/).fill('-5')
  await page.waitForTimeout(1000)
  await resaltar(page, page.getByRole('button', { name: 'Central con ajuste' }), 3)
  await capturar(page, G3, '02-ajuste-central'); await quitarResaltados(page)
  await page.getByRole('button', { name: 'Sin IVA' }).click()
  await page.waitForTimeout(800)
  await resaltar(page, page.getByRole('button', { name: 'Sin IVA' }), 5)
  await capturar(page, G3, '03-sin-iva'); await quitarResaltados(page)
  await irA(page, `/empresas/edit/${jc.id}/precios`)
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(1200)
  await capturar(page, G3, '04-precios-mundo-jc')
  await irA(page, '/categorias')
  await page.getByRole('button', { name: 'Expandir todo' }).click().catch(() => {})
  await page.waitForTimeout(400)
  await capturar(page, G3, '05-iva-por-categoria')
  const p = await leer<{ id: string }>('admin', 'productos?select=id&id=eq.98facf37-a18c-4e12-a974-597f27dad302', 'dominio')
  await irA(page, `/productos/${p[0].id}/edit`)
  await page.waitForTimeout(1200)
  const yIva = await topDe(page, 'Imágenes', 3).catch(() => topDe(page, 'Imágenes'))
  const yCat = await topDe(page, 'Disponibilidad')
  await franja(page, yCat - 8, yIva - 8, G3, '06-iva-del-producto')
})

// ───────────────────────── rentabilidad ─────────────────────────
const G4 = 'rentabilidad'
test('rentabilidad: pestañas y umbral', async ({ page }) => {
  await panel(page)
  await irA(page, '/rentabilidad')
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(1500)
  await capturar(page, G4, '01-resumen')
  await resaltar(page, page.getByRole('button', { name: /Umbral de margen bajo/ }), 1)
  await capturar(page, G4, '02-boton-umbral'); await quitarResaltados(page)
  await page.getByRole('button', { name: /Umbral de margen bajo/ }).click()
  await page.waitForTimeout(600)
  if (await page.getByRole('dialog').count()) { await capturar(page.getByRole('dialog'), G4, '03-umbral'); await page.getByRole('button', { name: 'Cancelar' }).click() }
})
test('rentabilidad: rol sin acceso', async ({ page }) => {
  await panel(page, 'operador')
  await page.goto('/rentabilidad'); await page.waitForLoadState('networkidle'); await page.waitForTimeout(1000)
  await capturar(page, G4, '07-acceso-restringido')
  await irA(page, '/productos'); await page.waitForTimeout(1000)
  await capturar(page, G4, '08-productos-sin-costo')
})

// ───────────────────────── tiendas-online ─────────────────────────
const G5 = 'tiendas-online'
test('tienda pública San Javucho', async ({ page }) => {
  await conTiendas(page)
  await abrirTienda(page, SJ)
  await capturar(page, G5, '01-inicio-san-javucho')
  await page.locator('a', { hasText: 'Joysticks' }).first().click()
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(1000)
  await capturar(page, G5, '02-categoria')
  await page.goto(SJ + '/catalogo'); await page.waitForLoadState('networkidle'); await page.waitForTimeout(1000)
  await capturar(page, G5, '03-catalogo')
  await page.getByPlaceholder('Buscar productos').fill('joystick')
  await page.waitForTimeout(1500)
  await capturar(page, G5, '04-busqueda')
  await page.keyboard.press('Escape')
  await page.goto(SJ + '/'); await page.waitForLoadState('networkidle'); await page.waitForTimeout(800)
  await page.getByText('Joystick DualSense PS5 blanco').first().click()
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(1200)
  await page.evaluate(() => window.scrollTo(0, 0)); await capturar(page, G5, '05-ficha')
  const wa = page.getByRole('button', { name: /WhatsApp/ }).or(page.getByRole('link', { name: /WhatsApp/ })).first()
  if (await wa.count()) { await wa.click(); await page.waitForTimeout(800); await page.evaluate(() => window.scrollTo(0, 0)); await capturar(page, G5, '06-whatsapp') } else console.log('SIN BOTON WHATSAPP')
})
test('tienda pública: contacto y móvil', async ({ page }) => {
  await conTiendas(page)
  await page.goto(SJ + '/contacto'); await page.waitForLoadState('networkidle'); await page.waitForTimeout(1200)
  await capturar(page, G5, '07-contacto')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(SJ + '/'); await page.waitForLoadState('networkidle'); await page.waitForTimeout(1200)
  await capturar(page, G5, '08-movil-inicio')
  await page.getByRole('button', { name: /menú/i }).first().click().catch(() => {})
  await page.waitForTimeout(600)
  await capturar(page, G5, '09-movil-menu')
})
test('tiendas: gestión catálogo visible', async ({ page }) => {
  await panel(page)
  const emp = await leer<{ id: string; nombre: string }>('admin', 'empresas?select=id,nombre', 'dominio')
  const sj = emp.find((e) => e.nombre === 'San Javucho')!
  await irA(page, `/empresas/${sj.id}/tienda/catalogo`)
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(1500)
  await capturar(page, G5, '10-catalogo-visible')
  await irA(page, '/empresas')
  await capturar(page, G5, '11-empresas')
  await irA(page, `/empresas/edit/${sj.id}`)
  await ocultar(page.getByText(/MSF-\d+/))
  await ocultar(page.getByText('Avisos de consultas').locator('..'))
  await capturar(page, G5, '12-empresa-pausar')
})

// ───────────────────────── tienda-dominio-e-identidad ─────────────────────────
const G6 = 'tienda-dominio-e-identidad'
test('identidad y contenido de las tiendas', async ({ page }) => {
  await panel(page)
  const emp = await leer<{ id: string; nombre: string }>('admin', 'empresas?select=id,nombre', 'dominio')
  const sj = emp.find((e) => e.nombre === 'San Javucho')!, jc = emp.find((e) => e.nombre === 'Mundo JC')!
  await irA(page, '/empresas')
  await capturar(page, G6, '01-lista-empresas')
  await irA(page, `/empresas/${sj.id}/tienda/identidad`); await page.waitForLoadState('networkidle'); await page.waitForTimeout(1000)
  await capturar(page, G6, '02-identidad-san-javucho')
  await irA(page, `/empresas/${jc.id}/tienda/identidad`); await page.waitForLoadState('networkidle'); await page.waitForTimeout(1000)
  await capturar(page, G6, '03-identidad-mundo-jc')
  await irA(page, `/empresas/${sj.id}/tienda/contenido`); await page.waitForLoadState('networkidle'); await page.waitForTimeout(1000)
  await capturar(page, G6, '04-contenido')
  await irA(page, `/empresas/edit/${sj.id}`)
  await ocultar(page.getByText('Avisos de consultas').locator('..'))
  await capturar(page, G6, '05-empresa-dominio')
})
test('las dos tiendas', async ({ page }) => {
  await conTiendas(page)
  await abrirTienda(page, JC)
  await capturar(page, G6, '06-tienda-mundo-jc')
  await page.screenshot({ path: '/destino/tienda-dominio-e-identidad/07-tienda-mundo-jc-completa.png', animations: 'disabled' })
  await abrirTienda(page, SJ)
  await page.screenshot({ path: '/destino/tienda-dominio-e-identidad/08-tienda-san-javucho-arriba.png', animations: 'disabled' })
})

// ───────────────────────── cuenta-web-cliente ─────────────────────────
const G7 = 'cuenta-web-cliente'
test('cuenta web en la ficha', async ({ page }) => {
  await panel(page)
  await irA(page, '/clientes')
  await page.getByRole('button', { name: 'Con cuenta web' }).click().catch(() => page.getByLabel('Con cuenta web').click())
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(1000)
  await capturar(page, G7, '01-filtro-con-cuenta')
  await page.locator('a', { hasText: 'Ver ficha' }).first().click()
  await expect(page.getByText('Cuenta web').first()).toBeVisible()
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(1000)
  await page.setViewportSize({ width: 1440, height: 1250 }); await page.waitForTimeout(500)
  await page.getByRole('tab', { name: 'San Javucho' }).click(); await page.waitForTimeout(600)
  await capturar(page, G7, '02-ficha-cuenta-activa')
})
test('cuenta web suspendida y sin cuenta', async ({ page }) => {
  await panel(page)
  await irA(page, '/clientes')
  await page.getByLabel('Buscar clientes').fill('')
  const fila = page.getByRole('row').filter({ hasText: 'Suspendida' }).first()
  if (await fila.count()) {
    await fila.locator('a', { hasText: 'Ver ficha' }).click()
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(1000)
    await page.setViewportSize({ width: 1440, height: 1250 })
    await page.getByRole('tab', { name: 'San Javucho' }).click()
    await page.waitForTimeout(600)
    await resaltar(page, page.getByRole('button', { name: /Reactivar acceso/ }), 1)
    await capturar(page, G7, '03-ficha-suspendida'); await quitarResaltados(page)
  } else console.log('SIN CLIENTE SUSPENDIDO EN LA PÁGINA 1')
})
test('cliente: crear con cuenta web', async ({ page }) => {
  await panel(page)
  await irA(page, '/clientes/create')
  await page.getByLabel(/Nombre o razón social/).fill('Tienda Gamer del Sur S.R.L.')
  await page.getByRole('textbox', { name: 'Correo' }).fill('compras@gamerdelsur.demo')
  await page.getByRole('button', { name: 'Activa', exact: true }).click()
  await page.waitForTimeout(500)
  await capturar(page, G7, '04-formulario-cuenta-web')
})
test('ingreso del cliente a la tienda', async ({ page }) => {
  await conTiendas(page)
  await page.goto(SJ + '/ingresar'); await page.waitForLoadState('networkidle'); await page.waitForTimeout(1500)
  await capturar(page, G7, '05-ingresar-tienda')
})

// ───────────────────────── clientes ─────────────────────────
const G8 = 'clientes'
test('clientes: listado y filtros', async ({ page }) => {
  await page.setViewportSize({ width: 1700, height: 900 })
  await panel(page)
  await irA(page, '/clientes')
  await page.getByLabel('Buscar clientes').fill('video')
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(1000)
  await resaltar(page, page.getByLabel('Buscar clientes'), 1)
  await capturar(page, G8, '02-busqueda'); await quitarResaltados(page)
  await page.getByLabel('Buscar clientes').fill('')
  await page.getByRole('button', { name: 'Mayorista', exact: true }).click()
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(1000)
  await resaltar(page, page.getByRole('button', { name: 'Mayorista', exact: true }), 2)
  await capturar(page, G8, '03-mayoristas'); await quitarResaltados(page)
  await page.getByRole('button', { name: 'Todos', exact: true }).first().click()
  await page.getByRole('button', { name: 'Archivados' }).click()
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(1000)
  await capturar(page, G8, '04-archivados')
})
test('clientes: alta, ficha, archivar y exportar', async ({ page }) => {
  await panel(page)
  await irA(page, '/clientes')
  await resaltar(page, page.getByRole('link', { name: 'Crear' }).or(page.getByRole('button', { name: 'Crear' })), 1)
  await capturar(page, G8, '05-boton-crear'); await quitarResaltados(page)
  await irA(page, '/clientes/create')
  await page.getByLabel(/Nombre o razón social/).fill('Tienda Gamer del Sur S.R.L.')
  await page.getByRole('textbox', { name: 'Correo' }).fill('compras@gamerdelsur.demo')
  await page.getByLabel('Teléfono', { exact: true }).fill('(11) 555-0142').catch(() => {})
  await page.waitForTimeout(500)
  await capturar(page, G8, '06-alta')
  await irA(page, '/clientes')
  await page.getByRole('row').filter({ hasText: 'Minorista' }).first().locator('a', { hasText: 'Ver ficha' }).click()
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(1200)
  await page.setViewportSize({ width: 1440, height: 1250 }); await page.waitForTimeout(500)
  await capturar(page, G8, '07-ficha-minorista')
  await resaltar(page, page.getByRole('button', { name: 'Crear cuenta web' }), 4)
  await capturar(page, G7, '06-crear-cuenta-web'); await quitarResaltados(page)
  await page.getByRole('button', { name: 'Archivar' }).click()
  await page.waitForTimeout(600)
  if (await page.getByRole('dialog').count()) { await capturar(page.getByRole('dialog'), G8, '08-archivar'); await page.getByRole('button', { name: 'Cancelar' }).click() }
  await irA(page, '/clientes')
  await page.getByRole('button', { name: 'Exportar' }).click()
  await page.waitForTimeout(800)
  if (await page.getByRole('dialog').count()) { await capturar(page.getByRole('dialog'), G8, '09-exportar'); await page.getByRole('button', { name: 'Cancelar' }).first().click().catch(() => page.keyboard.press('Escape')) }
  await page.getByRole('tab', { name: 'Ranking por facturación' }).click()
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(1500)
  await capturar(page, G8, '10-ranking')
})
