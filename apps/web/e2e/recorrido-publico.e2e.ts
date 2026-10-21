import { expect, test } from '@playwright/test'
import { paso, prepararPaginaVisible } from './visible'

// Tour público completo (MSF-119 T020): una persona sin sesión recorre la app,
// siempre termina en el ingreso y el camino de recuperación funciona. Un solo
// test = un solo video del recorrido entero. No toca el backend: solo navega,
// escribe en un campo (sin enviar) y verifica textos y redirecciones.
test.describe('Recorrido público', () => {
  test.beforeEach(async ({ page }) => {
    await prepararPaginaVisible(page)
  })

  test('[MSF-119:T020] sin sesión todo lleva al ingreso y la recuperación responde', async ({ page }) => {
    await paso(page, 'Abre la app sin sesión', () => page.goto('/'))
    await paso(page, 'Verifica que pide ingresar', async () => {
      await expect(page).toHaveURL(/\/login/)
      await expect(page.getByRole('heading', { name: 'Ingresar' })).toBeVisible()
    })

    for (const ruta of ['/stock', '/clientes', '/empresas']) {
      await paso(page, `Prueba ${ruta} sin sesión`, () => page.goto(ruta))
      await paso(page, 'Verifica que pide ingresar', async () => {
        await expect(page).toHaveURL(/\/login/)
      })
    }

    await paso(page, 'Abre la recuperación de acceso', () => page.goto('/acceso/solicitar-recuperacion'))
    await paso(page, 'Escribe el correo (sin enviar)', () =>
      page.getByLabel(/email/i).fill('demo@example.com'),
    )
    await paso(page, 'Verifica que puede pedir el enlace', async () => {
      await expect(page.getByRole('button', { name: 'Enviar enlace de recuperacion' })).toBeEnabled()
    })

    await paso(page, 'Abre un enlace vencido', () => page.goto('/acceso/solicitar-recuperacion?enlace=vencido'))
    await paso(page, 'Verifica el aviso y la salida', async () => {
      await expect(page.getByText('El enlace vencio o ya se uso')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Enviar enlace de recuperacion' })).toBeEnabled()
    })

    await paso(page, 'Vuelve al ingreso', () => page.goto('/login'))
    await paso(page, 'Verifica que está en el ingreso', async () => {
      await expect(page.getByRole('heading', { name: 'Ingresar' })).toBeVisible()
    })
  })
})
