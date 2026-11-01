import { expect, test, type Page } from '@playwright/test'
import { ANON, URL_API, capturar, correoDe, ingresar, irA, ocultar, PASSWORD, quitarResaltados, resaltar, elegir, type Rol } from './lib'

// Capturas del módulo de Ventas del manual de usuario. Solo lectura: se abren diálogos y formularios, nunca se confirman.

async function rpc<T = any>(rol: Rol, fn: string, body: Record<string, unknown> = {}): Promise<T> {
  const t = await fetch(`${URL_API}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON ?? '', 'content-type': 'application/json' }, body: JSON.stringify({ email: correoDe(rol), password: PASSWORD }),
  })
  const { access_token: token } = (await t.json()) as { access_token: string }
  const r = await fetch(`${URL_API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: ANON ?? '', authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`rpc ${fn}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T
}

type Comp = { id: string; numero: string; tipo: string; estado: string; cliente: string; total: number; envio: string | null }
async function comprobantes(rol: Rol = 'admin', extra: Record<string, unknown> = {}): Promise<Comp[]> {
  return rpc<Comp[]>(rol, 'listar_comprobantes', { p_pagina: 1, p_tamano: 200, ...extra })
}


const G = (guia: string, nombre: string) => ({ guia, nombre })

// Tarjeta (Paper) de una pantalla de detalle, ubicada por su título.
const tarjeta = (page: Page, titulo: string | RegExp) =>
  page.getByRole('heading', { name: titulo }).first().locator('xpath=ancestor::*[contains(@class,"MuiPaper-root")][1]')

async function listo(page: Page) {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(400)
}
// «Etapa 2» es jerga de desarrollo: se oculta en las capturas.
async function limpiarJerga(page: Page) {
  await ocultar(page.getByText(/Etapa 2/))
}


async function facturaConNota(cs: Comp[]): Promise<Comp> {
  for (const c of cs.filter((x) => x.tipo === 'factura' && ['cobrado', 'confirmada', 'deuda'].includes(x.estado))) {
    const d = await rpc('administracion', 'detalle_anulacion_nota_credito', { p_id: c.id })
    if (d?.notas?.length) return c
  }
  throw new Error('no hay factura con nota de crédito')
}


const abrirFiltro = async (page: Page, nombre: RegExp) => {
  await page.getByRole('button', { name: nombre }).first().click()
  await expect(page.getByRole('listbox').or(page.getByRole('menu'))).toBeVisible()
}
const abrirDialogo = async (page: Page, nombre: string | RegExp) => {
  await page.getByRole('button', { name: nombre }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.waitForTimeout(700)
}
const sinTotalesGigantes = () => {}

const C = 'ventas-comprobantes'
const L = 'ventas-listado-estados-y-anulacion'
const K = 'ventas-cobros-y-conciliacion'
const D = 'ventas-despacho-y-faltantes'
const R = 'ventas-rma-devoluciones'
const I = 'ventas-impresion'
const H = 'ventas-historial-consulta'

test.describe('Ventas', () => {
  test.skip(!URL_API || !ANON, 'Requiere el dataset demo')
  test.setTimeout(75_000)

  // ---------------------------------------------------------------- comprobantes
  test('comprobantes: formulario nuevo', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 })
    await ingresar(page, 'mostrador')
    await irA(page, '/ventas/comprobantes')
    await resaltar(page, page.getByRole('button', { name: 'Nuevo comprobante' }).or(page.getByRole('link', { name: 'Nuevo comprobante' })), 1)
    await capturar(page, C, '02-boton-nuevo')
    await quitarResaltados(page)
    await page.setViewportSize({ width: 1280, height: 1000 })
    await irA(page, '/ventas/comprobantes/nuevo')
    await limpiarJerga(page)
    await page.getByRole('combobox', { name: /Cliente/ }).click()
    await page.getByRole('option').nth(1).click()
    await listo(page)
    await resaltar(page, page.getByRole('group', { name: 'Tipo de comprobante' }), 2)
    await resaltar(page, page.getByRole('group', { name: 'Tienda' }), 3)
    await resaltar(page, page.getByRole('group', { name: 'Canal de venta' }), 4)
    await resaltar(page, page.getByRole('combobox', { name: /Cliente/ }), 5)
    await resaltar(page, page.getByRole('button', { name: 'Guardar cambios' }), 8)
    await capturar(page, C, '03-formulario-completo')
    await quitarResaltados(page)
    await page.getByRole('button', { name: 'Presupuesto' }).first().click()
    await expect(page.getByLabel('Válido hasta')).toBeVisible()
    await page.getByLabel('Válido hasta').scrollIntoViewIfNeeded()
    await resaltar(page, page.getByLabel('Válido hasta'), 6)
    await capturar(page, C, '04-formulario-presupuesto')
  })

  test('comprobantes: borrador y lineas', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await ingresar(page, 'mostrador')
    const cs = await comprobantes('mostrador')
    const bor = cs.find((c) => c.estado === 'borrador' && c.numero === '00000030')!
    await irA(page, `/ventas/comprobantes/${bor.id}`)
    await limpiarJerga(page)
    await page.setViewportSize({ width: 1280, height: 3000 })
    await listo(page)
    const lineas = tarjeta(page, 'Líneas')
    await resaltar(page, lineas.getByRole('button', { name: 'Agregar producto' }), 1)
    await capturar(lineas, C, '05-lineas-y-totales')
    await quitarResaltados(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.getByRole('button', { name: 'Agregar producto' }).click()
    const dlg = page.getByRole('dialog')
    await expect(dlg).toBeVisible()
    await dlg.getByRole('combobox').first().fill('Cable')
    await page.getByRole('option').first().waitFor()
    await page.getByRole('option').first().click()
    await listo(page)
    await page.waitForTimeout(600)
    await resaltar(page, dlg.getByRole('combobox').first(), 2)
    await resaltar(page, dlg.getByRole('button', { name: 'Agregar', exact: true }), 3)
    await capturar(page, C, '06-agregar-producto')
    await quitarResaltados(page)
    await page.keyboard.press('Escape')
  })

  test('comprobantes: precio manual, faltante y confirmar', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 3000 } })
    const page = await ctx.newPage()
    await ingresar(page, 'operador')
    const cs = await comprobantes('operador')
    const bor = cs.find((c) => c.estado === 'borrador' && c.numero === '00000030')!
    await irA(page, `/ventas/comprobantes/${bor.id}`)
    await limpiarJerga(page)
    await capturar(tarjeta(page, 'Líneas'), C, '07-precio-manual-operador')
    const sin = cs.find((c) => c.estado === 'borrador' && c.numero === '00000025')!
    await irA(page, `/ventas/comprobantes/${sin.id}`)
    await limpiarJerga(page)
    await capturar(tarjeta(page, 'Líneas'), C, '08-aviso-faltante')
    await irA(page, `/ventas/comprobantes/${bor.id}`)
    await limpiarJerga(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.getByRole('button', { name: 'Confirmar factura' }).click()
    const dlg = page.getByRole('dialog')
    await expect(dlg).toBeVisible()
    await page.waitForTimeout(700)
    await resaltar(page, dlg.getByRole('button', { name: 'Confirmar', exact: true }), 3)
    await capturar(page, C, '09-dialogo-confirmar')
    await quitarResaltados(page)
    await dlg.getByRole('button', { name: 'Cancelar' }).click()
    await ctx.close()
  })

  test('comprobantes: presupuestos copiar', async ({ page }) => {
    await page.setViewportSize({ width: 1700, height: 900 })
    await ingresar(page, 'mostrador')
    await irA(page, '/ventas/presupuestos')
    const copiar = page.getByRole('button', { name: 'Copiar' }).first()
    await copiar.scrollIntoViewIfNeeded()
    await resaltar(page, copiar, 1)
    await capturar(page, C, '10-presupuesto-copiar')
  })

  // ---------------------------------------------------------------- listado
  test('listado: filtros', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 })
    await ingresar(page, 'administracion')
    await irA(page, '/ventas/comprobantes')
    await capturar(page, L, '01-listado-columnas')
    await abrirFiltro(page, /Estado:/)
    await capturar(page, L, '02-filtro-estado')
    await page.getByRole('menuitem', { name: 'Deuda' }).or(page.getByRole('option', { name: 'Deuda' })).click()
    await page.getByRole('button', { name: 'Todas las tiendas' }).click()
    await listo(page)
    await capturar(page, L, '04-estado-deuda')
    await irA(page, '/ventas/comprobantes')
    await page.getByRole('button', { name: 'Todas las tiendas' }).click()
    await page.getByLabel('Buscar por cliente o número').fill('Ezequiel')
    await listo(page)
    await resaltar(page, page.getByRole('button', { name: 'Todas las tiendas' }), 1)
    await resaltar(page, page.getByLabel('Buscar por cliente o número'), 2)
    await capturar(page, L, '03-tienda-y-busqueda')
  })

  test('listado: detalle, anulacion y notas', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 3000 })
    await ingresar(page, 'administracion')
    const cs = await comprobantes('administracion')
    const pend = cs.find((c) => c.estado === 'confirmada' && c.tipo === 'factura' && c.numero === '00000065')!
    await irA(page, `/ventas/comprobantes/${pend.id}`)
    await limpiarJerga(page)
    await page.screenshot({ path: `/destino/${L}/05-detalle-cabecera.png`, clip: { x: 240, y: 60, width: 1040, height: 840 } })
    await capturar(tarjeta(page, 'Estado'), L, '06-tarjeta-estado')
    await page.setViewportSize({ width: 1280, height: 900 })
    const f = cs.find((c) => c.estado === 'confirmada' && c.tipo === 'factura' && c.numero === '00000064')!
    await irA(page, `/ventas/comprobantes/${f.id}`)
    await limpiarJerga(page)
    const btn = page.getByRole('button', { name: 'Anular', exact: true })
    await resaltar(page, btn, 2)
    await capturar(page, L, '07-boton-anular')
    await quitarResaltados(page)
    await btn.click()
    const dlg = page.getByRole('dialog')
    await expect(dlg).toBeVisible()
    await dlg.getByLabel('Motivo de la anulación').fill('Factura cargada por error: el cliente no concretó la compra.')
    await page.waitForTimeout(700)
    await resaltar(page, dlg.getByLabel('Motivo de la anulación'), 3)
    await resaltar(page, dlg.getByRole('button', { name: 'Anular factura' }), 4)
    await capturar(page, L, '08-dialogo-anular')
    await quitarResaltados(page)
    await dlg.getByRole('button', { name: 'Cancelar' }).click()
    await page.getByRole('button', { name: 'Nota de crédito', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.waitForTimeout(700)
    await capturar(page, L, '10-dialogo-nota-credito')
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click()
    const an = cs.find((c) => c.estado === 'anulada')!
    await irA(page, `/ventas/comprobantes/${an.id}`)
    await limpiarJerga(page)
    await capturar(page, L, '09-factura-anulada')
    await page.setViewportSize({ width: 1280, height: 3200 })
    const cn = await facturaConNota(cs)
    await irA(page, `/ventas/comprobantes/${cn.id}`)
    await limpiarJerga(page)
    await expect(page.getByText('Asociada a esta factura')).toBeVisible()
    await capturar(tarjeta(page, /^Nota de crédito \d+/), L, '11-nota-credito-asociada')
  })

  // ---------------------------------------------------------------- cobros
  test('cobros: dialogo y deuda', async ({ page }) => {
    await ingresar(page, 'administracion')
    const cs = await comprobantes('administracion')
    const f = cs.find((c) => c.estado === 'confirmada' && c.tipo === 'factura' && c.numero === '00000066')!
    await page.setViewportSize({ width: 1280, height: 3000 })
    await irA(page, `/ventas/comprobantes/${f.id}`)
    await limpiarJerga(page)
    const t = tarjeta(page, 'Cobros')
    await resaltar(page, t.getByRole('button', { name: 'Registrar cobro' }), 3)
    await capturar(t, K, '01-tarjeta-cobros')
    await quitarResaltados(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await abrirDialogo(page, 'Registrar cobro')
    const dlg = page.getByRole('dialog')
    await elegir(page, 'Forma de pago', /Transferencia/, dlg)
    await elegir(page, 'Cuenta de cobro', /./, dlg)
    await dlg.getByLabel('Importe').fill('200000')
    await listo(page)
    await resaltar(page, dlg.getByRole('combobox', { name: 'Forma de pago' }), 4)
    await resaltar(page, dlg.getByRole('combobox', { name: 'Cuenta de cobro' }), 5)
    await resaltar(page, dlg.getByLabel('Importe'), 6)
    await resaltar(page, dlg.getByRole('button', { name: 'Registrar cobro' }), 7)
    await capturar(page, K, '02-dialogo-registrar-cobro')
    await quitarResaltados(page)
    await dlg.getByRole('button', { name: 'Cancelar' }).click()
    const deu = await comprobantes('administracion', { p_estado: 'deuda' })
    await page.setViewportSize({ width: 1280, height: 3000 })
    await irA(page, `/ventas/comprobantes/${deu[0].id}`)
    await limpiarJerga(page)
    await capturar(tarjeta(page, 'Cobros'), K, '03-cobros-deuda')
  })

  test('cobros: pagos, contrarreembolsos, cuentas y formas', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 })
    await ingresar(page, 'administracion')
    await irA(page, '/ventas/pagos')
    await resaltar(page, page.getByRole('switch').first(), 2)
    await capturar(page, K, '04-pagos-conciliar')
    await irA(page, '/ventas/transportes')
    await page.getByRole('tab', { name: /Contrarreembolsos/ }).click()
    await listo(page)
    await resaltar(page, page.getByRole('button', { name: 'Marcar cobrado' }).and(page.locator(':not([disabled])')).first(), 4)
    await capturar(page, K, '05-contrarreembolsos')
    const ctx = await page.context().browser()!.newContext({ viewport: { width: 1600, height: 1000 } })
    const p2 = await ctx.newPage()
    await ingresar(p2, 'admin')
    await irA(p2, '/ventas/cuentas-cobro')
    await abrirDialogo(p2, 'Nueva cuenta de cobro')
    await capturar(p2, K, '06-cuenta-alta')
    await irA(p2, '/ventas/configuracion')
    await capturar(p2, K, '07-formas-de-pago')
    await abrirDialogo(p2, 'Nueva forma de pago')
    await capturar(p2, K, '08-forma-de-pago-alta')
    await ctx.close()
  })

  // ---------------------------------------------------------------- despacho
  test('despacho: tablero', async ({ page }) => {
    await page.setViewportSize({ width: 1700, height: 1000 })
    await ingresar(page, 'deposito')
    await irA(page, '/ventas/despacho')
    const grupo = page.getByRole('group', { name: 'Filtrar por estado' })
    const panel = grupo.locator('xpath=ancestor::*[contains(@class,"MuiPaper-root")][1]')
    await resaltar(page, grupo, 1)
    await capturar(page, D, '01-despacho-estados')
    await quitarResaltados(page)
    await grupo.getByRole('button', { name: /^Entregado/ }).click()
    await listo(page)
    await capturar(page, D, '02-despacho-entregado')
    await grupo.getByRole('button', { name: /^Armando/ }).click()
    await listo(page)
    await page.getByRole('link', { name: /^00000/ }).first().click()
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'Responsables' })).toBeVisible()
    await page.setViewportSize({ width: 1280, height: 3000 })
    await listo(page)
    const t = tarjeta(page, 'Responsables')
    await resaltar(page, t.getByRole('button', { name: /Incompleto|Ajustar faltantes/ }), 1)
    await capturar(t, D, '03-tarjeta-responsables')
    await quitarResaltados(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await t.getByRole('button', { name: /Incompleto|Ajustar faltantes/ }).click()
    const dlg = page.getByRole('dialog')
    await expect(dlg).toBeVisible()
    await page.waitForTimeout(700)
    await dlg.getByLabel(/Cantidad faltante/).first().fill('1')
    await resaltar(page, dlg.getByLabel(/Cantidad faltante/).first(), 2)
    await resaltar(page, dlg.getByRole('button', { name: 'Registrar faltantes' }), 3)
    await capturar(page, D, '04-dialogo-faltantes')
    await quitarResaltados(page)
    await dlg.getByRole('button', { name: 'Cancelar' }).click()
  })

  test('despacho: faltantes, transportes, envio', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 })
    await ingresar(page, 'admin')
    await irA(page, '/ventas/faltantes')
    await capturar(page, D, '05-faltantes')
    await irA(page, '/ventas/transportes')
    await page.getByRole('tab', { name: /Terminales de retiro/ }).click()
    await listo(page)
    await capturar(page, D, '06-transportes-terminales')
    await page.setViewportSize({ width: 1600, height: 1250 })
    await abrirDialogo(page, 'Nueva empresa')
    await capturar(page, D, '07-alta-transporte')
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 1600, height: 1000 })
    await irA(page, '/ventas/configuracion')
    await page.getByRole('tab', { name: 'Formas de envío' }).click()
    await listo(page)
    await capturar(page, D, '09-formas-de-envio')
    const cs = await comprobantes('admin')
    const f = cs.find((c) => c.estado === 'confirmada' && c.tipo === 'factura' && /Correo|Expreso/.test(c.envio ?? ''))!
    await page.setViewportSize({ width: 1280, height: 3000 })
    await irA(page, `/ventas/comprobantes/${f.id}`)
    await limpiarJerga(page)
    await capturar(tarjeta(page, /Envío y transporte/), D, '08-envio-transporte')
  })

  // ---------------------------------------------------------------- RMA
  test('rma', async ({ page }) => {
    await page.setViewportSize({ width: 1700, height: 1300 })
    await ingresar(page, 'administracion')
    await irA(page, '/ventas/devoluciones')
    await capturar(page, R, '03-rma-en-gestion')
    await abrirDialogo(page, 'Nueva devolución')
    await capturar(page, R, '02-alta-devolucion')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'San Javucho' }).click()
    await listo(page)
    await resaltar(page, page.getByRole('button', { name: 'Devolución de importe' }), 1)
    await capturar(page, R, '01-rma-san-javucho')
    await quitarResaltados(page)
    const fila = page.getByRole('row').filter({ hasText: 'RMA-0009' })
    await capturar(fila, R, '04-rma-cerrada-nota-credito')
    await page.getByRole('button', { name: 'Emitir nota de crédito' }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.waitForTimeout(700)
    await capturar(page, R, '05-dialogo-emitir-nota')
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click()
    await page.getByRole('button', { name: 'Reingresar stock' }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.waitForTimeout(700)
    await capturar(page, R, '06-dialogo-reingresar-stock')
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click()
  })

  // ---------------------------------------------------------------- impresión
  test('impresion', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 3000 })
    await ingresar(page, 'administracion')
    const cs = await comprobantes('administracion')
    const f = cs.find((c) => c.estado === 'confirmada' && c.tipo === 'factura' && c.numero === '00000065')!
    await irA(page, `/ventas/comprobantes/${f.id}`)
    await limpiarJerga(page)
    const t = tarjeta(page, 'Documentos')
    await resaltar(page, t.getByRole('button', { name: 'Imprimir remito' }), 1)
    await capturar(t, I, '02-tarjeta-documentos')
    await quitarResaltados(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.getByRole('button', { name: 'Imprimir', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.waitForTimeout(700)
    await capturar(page, I, '01-dialogo-imprimir')
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click()
    await page.setViewportSize({ width: 1700, height: 900 })
    await irA(page, '/ventas/presupuestos')
    const imp = page.getByRole('button', { name: 'Imprimir' }).first()
    await imp.scrollIntoViewIfNeeded()
    await resaltar(page, imp, 1)
    await capturar(page, I, '04-presupuestos-imprimir')
    await quitarResaltados(page)
    await page.setViewportSize({ width: 1280, height: 3000 })
    await page.getByRole('link', { name: /^00000/ }).first().click()
    await expect(page.getByRole('heading', { name: 'Documentos' })).toBeVisible()
    await listo(page)
    await capturar(tarjeta(page, 'Documentos'), I, '03-presupuesto-documentos')
  })

  // ---------------------------------------------------------------- historial
  test('historial', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 650 })
    await ingresar(page, 'consulta')
    await irA(page, '/historial')
    await page.getByRole('button', { name: 'Todas las tiendas' }).click()
    await listo(page)
    await capturar(page, H, '01-ventas')
    await page.getByRole('tab', { name: /Cobros/ }).click(); await listo(page)
    await capturar(page, H, '02-cobros')
    await page.getByRole('tab', { name: /Cotizaciones/ }).click(); await listo(page)
    await capturar(page, H, '03-cotizaciones')
    const ctx = await page.context().browser()!.newContext({ viewport: { width: 1280, height: 520 } })
    const p2 = await ctx.newPage()
    await ingresar(p2, 'admin')
    await irA(p2, '/historial/importar')
    await capturar(p2, H, '04-importar')
    await ctx.close()
  })
})
