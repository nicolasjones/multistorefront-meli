import { expect, test } from '@playwright/test'

// Recorridos de acceso que no requieren usuarios sembrados (MSF-119 T020,
// parte pública). Ingreso con sesión, cierre de sesión y el resto de los
// recorridos dependen de fixtures por rol: ver docs/e2e-app.md.
test.describe('Acceso público', () => {
  test('una ruta protegida sin sesión lleva al ingreso', async ({ page }) => {
    await page.goto('/usuarios')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { name: 'Ingresar' })).toBeVisible()
  })

  test('la pantalla Actividad sin sesión lleva al ingreso (F-AUD-01)', async ({ page }) => {
    await page.goto('/actividad')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { name: 'Ingresar' })).toBeVisible()
  })

  test('el ingreso ofrece el camino a la recuperación', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('link', { name: '¿Olvidaste tu contraseña?' }).click()
    await expect(page).toHaveURL(/\/acceso\/solicitar-recuperacion/)
    await expect(page.getByRole('heading', { name: 'Recuperar acceso' })).toBeVisible()
  })

  test('un enlace vencido avisa y permite pedir uno nuevo', async ({ page }) => {
    await page.goto('/acceso/solicitar-recuperacion?enlace=vencido')
    await expect(page.getByText('El enlace venció o ya se usó')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Enviar enlace de recuperacion' })).toBeEnabled()
  })

  test('el ingreso no tiene registro propio', async ({ page }) => {
    await page.goto('/login')
    // Esperar a que React renderice antes de afirmar ausencias (evita falso verde).
    await expect(page.getByRole('heading', { name: 'Ingresar' })).toBeVisible()
    // Busca explícitamente textos de alta; un enlace legítimo futuro (ayuda, términos) no rompe el test.
    // `\balta\b` (no `alta` a secas: matchearía "falta", "salta", "resaltar").
    const alta = /registr|crear (una )?cuenta|nueva cuenta|unirse|suscrib|sign ?up|dar de alta|\balta\b/i
    await expect(page.getByRole('link', { name: alta })).toHaveCount(0)
    await expect(page.getByRole('button', { name: alta })).toHaveCount(0)
  })
})
