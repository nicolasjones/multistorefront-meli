import { expect, test, type Page } from '@playwright/test'
import { capturar, elegir, ingresar, irA, ocultar, quitarResaltados, resaltar, type Rol } from './lib'

// Páginas: Bienvenida, Capacidades, Usuarios y roles, Perfil, Acceso y sesión, Organización y empresas, Actividad.

// El menú es un acordeón (un grupo abierto a la vez): se abre el grupo indicado.
async function abrirGrupo(page: Page, grupo: string) {
  const g = page.locator('nav').getByRole('button', { name: new RegExp(`^${grupo}$`, 'i') })
  if (await g.count()) {
    if ((await g.first().getAttribute('aria-expanded')) !== 'true') await g.first().click()
    await page.waitForTimeout(400)
  }
}
// Recorte (la portada de Inicio tiene textos que no van en el manual): se captura solo el menú o la barra superior.
async function recorte(page: Page, guia: string, nombre: string, clip: { x: number; y: number; width: number; height: number }) {
  const { mkdirSync } = await import('node:fs')
  const { DESTINO } = await import('./lib')
  const carpeta = `${DESTINO}/${guia}`
  mkdirSync(carpeta, { recursive: true })
  await page.screenshot({ path: `${carpeta}/${nombre}.png`, clip, animations: 'disabled', caret: 'hide' })
}
const menuUsuario = (page: Page) => page.getByRole('banner').getByRole('button').last()

test('bienvenida: menú, barra superior y perfil', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await ingresar(page, 'admin')
  await irA(page, '/')
  await abrirGrupo(page, 'VENTAS')
  await recorte(page, 'README', '01-menu-lateral', { x: 0, y: 0, width: 250, height: 760 })
  await resaltar(page, page.getByRole('button', { name: /Empresa activa/ }), 1)
  await resaltar(page, menuUsuario(page), 2)
  await recorte(page, 'README', '02-barra-superior', { x: 240, y: 0, width: 1040, height: 64 })
  await quitarResaltados(page)
  await page.getByRole('button', { name: /Empresa activa/ }).click()
  await page.waitForTimeout(400)
  await recorte(page, 'README', '03-selector-empresa', { x: 240, y: 0, width: 640, height: 220 })
})

test('usuarios: listado, invitar, editar', async ({ page }) => {
  await ingresar(page, 'admin')
  await irA(page, '/usuarios')
  await expect(page.getByRole('button', { name: 'Editar' }).first()).toBeVisible()
  await page.waitForTimeout(800)
  await capturar(page, 'usuarios-y-roles', '01-listado')
  await page.getByRole('button', { name: 'Invitar usuario' }).click()
  const d = page.getByRole('dialog')
  await expect(d).toBeVisible()
  await d.getByLabel('Correo electrónico').fill('maria.gomez@ejemplo.com')
  await d.getByRole('radio', { name: /Operador/ }).check()
  await d.getByRole('checkbox', { name: /San Javucho/ }).check()
  await page.waitForTimeout(700)
  await capturar(d, 'usuarios-y-roles', '02-invitar-completo')
  await d.getByRole('button', { name: 'Cancelar' }).click()
  await page.getByRole('button', { name: 'Editar' }).nth(1).click()
  const e = page.getByRole('dialog')
  await expect(e.getByText('Editar usuario')).toBeVisible()
  await page.waitForTimeout(500)
  await capturar(e, 'usuarios-y-roles', '03-editar')
  await page.keyboard.press('Escape')
})

test('roles: matriz y acciones', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await ingresar(page, 'admin')
  await irA(page, '/roles')
  await page.waitForTimeout(800)
  await capturar(page, 'usuarios-y-roles', '04-roles-y-permisos')
  await capturar(page.getByRole('table').first(), 'usuarios-y-roles', '05-matriz-por-seccion')
  await page.getByRole('button', { name: 'Exportar', exact: true }).click()
  await page.getByText('Acciones sensibles').first().evaluate((e) => { e.scrollIntoView({ block: 'start' }); window.scrollBy(0, -80) })
  await page.evaluate(() => document.querySelectorAll('*').forEach((n) => { const el = n as HTMLElement; if (el.scrollTop > 0 && el.clientHeight > 300) el.scrollTop -= 0 }))
  await page.waitForTimeout(400)
  await capturar(page, 'usuarios-y-roles', '06-acciones-sensibles')
})

for (const rol of ['admin', 'mostrador', 'consulta'] as Rol[]) {
  test(`menú de ${rol}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await ingresar(page, rol)
    await irA(page, '/')
    if (rol === 'admin') await abrirGrupo(page, 'ADMINISTRACIÓN')
    await recorte(page, 'usuarios-y-roles', `${{ admin: '07-menu-administrador', mostrador: '08-menu-mostrador', consulta: '09-menu-consulta' }[rol as string]}`, { x: 0, y: 0, width: 250, height: 900 })
  })
}

test('perfil', async ({ page }) => {
  await ingresar(page, 'admin')
  await irA(page, '/')
  await menuUsuario(page).click()
  await page.waitForTimeout(400)
  await recorte(page, 'perfil-propio', '01-menu', { x: 880, y: 0, width: 400, height: 350 })
  await page.keyboard.press('Escape')
  await irA(page, '/cuenta/perfil')
  await capturar(page, 'perfil-propio', '02-perfil')
  await irA(page, '/cuenta/cambiar-contrasena')
  await recorte(page, 'perfil-propio', '03-cambiar-contrasena', { x: 240, y: 60, width: 1040, height: 400 })
  await irA(page, '/cuenta/cambiar-correo')
  await recorte(page, 'perfil-propio', '04-cambiar-correo', { x: 240, y: 60, width: 1040, height: 400 })
  await irA(page, '/cuenta/avisos')
  await recorte(page, 'perfil-propio', '05-avisos', { x: 240, y: 60, width: 1040, height: 400 })
})

test('acceso', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByLabel('Correo')).toBeVisible()
  await capturar(page, 'acceso-y-sesion', '01-ingreso')
  await page.getByLabel('Correo').fill('nadie.inexistente@ejemplo.com')
  await page.getByLabel('Contraseña').fill('ClaveEquivocada-123')
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page.getByText(/Revisá el correo y la contraseña/)).toBeVisible()
  await capturar(page, 'acceso-y-sesion', '02-error-ingreso')
  await page.goto('/acceso/solicitar-recuperacion')
  await expect(page.getByRole('button', { name: /Enviar enlace de recuperaci/ })).toBeVisible()
  await page.getByLabel('Email').fill('nombre@ejemplo.com')
  await capturar(page, 'acceso-y-sesion', '03-recuperar')
})

test('acceso restringido', async ({ page }) => {
  await ingresar(page, 'consulta')
  await page.goto('/usuarios')
  await expect(page.getByText('No tenés acceso a esta sección')).toBeVisible()
  await page.waitForTimeout(500)
  await capturar(page, 'acceso-y-sesion', '04-sin-acceso')
})

test('organización y empresas', async ({ page }) => {
  await ingresar(page, 'admin')
  await irA(page, '/organizacion')
  await capturar(page, 'organizacion-y-empresas', '01-mi-organizacion')
  await irA(page, '/empresas')
  await page.waitForTimeout(500)
  await capturar(page, 'organizacion-y-empresas', '02-empresas')
  await page.getByRole('link', { name: /Editar/ }).first().click()
  await expect(page.getByLabel('Nombre comercial')).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(500)
  await capturar(page, 'organizacion-y-empresas', '03-editar-empresa')
})

test('empresa activa', async ({ page }) => {
  await ingresar(page, 'admin')
  await irA(page, '/ventas/comprobantes')
  await page.getByRole('button', { name: /Empresa activa/ }).click()
  await capturar(page, 'organizacion-y-empresas', '04-selector-abierto')
  await page.getByRole('menuitem').filter({ hasNotText: 'Todas' }).first().click()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(800)
  await capturar(page, 'organizacion-y-empresas', '05-una-empresa')
  // La elección se guarda en el perfil: se vuelve a «Todas mis empresas».
  await page.getByRole('button', { name: /Empresa activa/ }).click()
  await page.getByRole('menuitem', { name: /Todas mis empresas/ }).click()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(800)
})

test('actividad', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await ingresar(page, 'admin')
  await irA(page, '/actividad')
  await page.waitForTimeout(500)
  await elegir(page, /Período/, /Todo el historial/)
  await page.waitForLoadState('networkidle')
  await page.getByRole('combobox', { name: 'Tipo' }).click()
  await page.waitForTimeout(500)
  await capturar(page, 'actividad', '02-filtro-tipo-abierto')
  await page.getByRole('option', { name: 'Comprobante cobro registrado' }).click()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(800)
  await expect(page.getByRole('row').nth(1)).toBeVisible()
  await resaltar(page, page.getByRole('row').nth(1), 1)
  await capturar(page, 'actividad', '03-filtrado-por-cobro')
  await quitarResaltados(page)
  await page.getByRole('combobox').nth(2).click()
  await page.getByRole('option', { name: 'Todos los tipos' }).click()
  await page.getByRole('button', { name: 'Mundo JC', exact: true }).click()
  await page.getByRole('combobox').nth(0).click()
  await page.getByRole('option', { name: /Últimos 30 días/ }).click()
  await page.getByRole('combobox').nth(2).click()
  await page.getByRole('option', { name: 'Comprobante estado cambiado' }).click()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(800)
  await capturar(page, 'actividad', '04-una-tienda-30-dias')
})
