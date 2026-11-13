// Recorrido de evidencia (MSF-119 T020): ingreso, recuperación y rutas protegidas con mouse visible y rótulos,
// para el video de muestra. Corre con `pnpm test:e2e:evidencia`.
import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixture'
import { paso, prepararPaginaVisible } from './visible'

test.setTimeout(180000)
test.beforeEach(async ({ page }) => {
  await prepararPaginaVisible(page)
})

async function mover(page: Page, loc: Locator) {
  const b = await loc.boundingBox()
  if (!b) throw new Error('sin boundingBox')
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 30 })
  await page.waitForTimeout(350)
}

async function moverYClick(page: Page, loc: Locator) {
  await mover(page, loc)
  await page.mouse.down()
  await page.waitForTimeout(80)
  await page.mouse.up()
}

test('[MSF-119:T020] recorrido visible: acceso, recuperación y rutas protegidas', async ({ page }) => {
  await page.goto('/login')
  await paso(page, 'Abre el ingreso', async () => {
    await expect(page.getByRole('heading', { name: 'Ingresar' })).toBeVisible()
  })

  const link = page.getByRole('link', { name: '¿Olvidaste tu contraseña?' })
  await paso(page, 'Va al camino de recuperación', async () => {
    await moverYClick(page, link)
    await expect(page).toHaveURL(/\/acceso\/solicitar-recuperacion/)
    await expect(page.getByRole('heading', { name: 'Recuperar acceso' })).toBeVisible()
  })

  const email = page.getByLabel(/email/i)
  await paso(page, 'Escribe el correo', async () => {
    await moverYClick(page, email)
    await page.keyboard.type('demo@example.com', { delay: 90 })
    await expect(email).toHaveValue('demo@example.com')
  })

  const send = page.getByRole('button', { name: 'Enviar enlace de recuperacion' })
  await paso(page, 'Verifica que puede pedir el enlace', async () => {
    await mover(page, send)
    await expect(send).toBeEnabled()
  })

  await page.goto('/acceso/solicitar-recuperacion?enlace=vencido')
  await paso(page, 'Abre un enlace vencido', async () => {
    await expect(page.getByText('El enlace vencio o ya se uso')).toBeVisible()
    await expect(send).toBeEnabled()
  })
  await mover(page, page.getByText('El enlace vencio o ya se uso'))
  await page.waitForTimeout(600)
  await mover(page, send)

  await page.goto('/stock')
  await paso(page, 'Una ruta protegida redirige al ingreso', async () => {
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { name: 'Ingresar' })).toBeVisible()
  })
  await mover(page, page.getByRole('heading', { name: 'Ingresar' }))
  await page.waitForTimeout(900)
})
