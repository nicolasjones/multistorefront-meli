import { expect, test } from '@playwright/test'
import { paso, prepararPaginaVisible } from './visible'

// Recorridos de acceso que no requieren usuarios sembrados (MSF-119 T020,
// parte pública). Ingreso con sesión, cierre de sesión y el resto de los
// recorridos dependen de fixtures por rol: ver docs/e2e-app.md.
test.describe('Acceso público', () => {
  test.beforeEach(async ({ page }) => {
    await prepararPaginaVisible(page)
  })

  test('[MSF-119:T020] una ruta protegida sin sesión lleva al ingreso', async ({ page }) => {
    await paso(page, 'Abre /usuarios sin sesión', () => page.goto('/usuarios'))
    await paso(page, 'Verifica que pide ingresar', async () => {
      await expect(page).toHaveURL(/\/login/)
      await expect(page.getByRole('heading', { name: 'Ingresar' })).toBeVisible()
    })
  })

  test('[MSF-119:T020] la pantalla Actividad sin sesión lleva al ingreso (F-AUD-01)', async ({ page }) => {
    await paso(page, 'Abre /actividad sin sesión', () => page.goto('/actividad'))
    await paso(page, 'Verifica que pide ingresar', async () => {
      await expect(page).toHaveURL(/\/login/)
      await expect(page.getByRole('heading', { name: 'Ingresar' })).toBeVisible()
    })
  })

  test('[MSF-119:T020] el ingreso ofrece el camino a la recuperación', async ({ page }) => {
    await paso(page, 'Abre /login', () => page.goto('/login'))
    await paso(page, 'Clic en "¿Olvidaste tu contraseña?"', () =>
      page.getByRole('link', { name: '¿Olvidaste tu contraseña?' }).click(),
    )
    await paso(page, 'Verifica la pantalla de recuperación', async () => {
      await expect(page).toHaveURL(/\/acceso\/solicitar-recuperacion/)
      await expect(page.getByRole('heading', { name: 'Recuperar acceso' })).toBeVisible()
    })
  })

  test('[MSF-119:T020] un enlace vencido avisa y permite pedir uno nuevo', async ({ page }) => {
    await paso(page, 'Abre el enlace vencido', () => page.goto('/acceso/solicitar-recuperacion?enlace=vencido'))
    await paso(page, 'Verifica el aviso y el botón para pedir otro', async () => {
      await expect(page.getByText('El enlace vencio o ya se uso')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Enviar enlace de recuperacion' })).toBeEnabled()
    })
  })

  test('[MSF-119:T020] el ingreso no tiene registro propio', async ({ page }) => {
    await paso(page, 'Abre /login', () => page.goto('/login'))
    await paso(page, 'Verifica que no ofrece registrarse', async () => {
      // Esperar a que React renderice antes de afirmar ausencias (evita falso verde).
      await expect(page.getByRole('heading', { name: 'Ingresar' })).toBeVisible()
      // Busca explícitamente textos de alta; un enlace legítimo futuro (ayuda, términos) no rompe el test.
      // `\balta\b` (no `alta` a secas: matchearía "falta", "salta", "resaltar").
      const alta = /registr|crear (una )?cuenta|nueva cuenta|unirse|suscrib|sign ?up|dar de alta|\balta\b/i
      await expect(page.getByRole('link', { name: alta })).toHaveCount(0)
      await expect(page.getByRole('button', { name: alta })).toHaveCount(0)
    })
  })
})
