import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { expect, test } from './fixture'
import { clic, escribir } from './visible'
import { altaUsuario, borrar, borrarUsuario, rest, serviceKey, url } from './soporte/fixtures'

// Actividad con filtros (F-AUD-01, MSF-463 T015): listado del Administrador con total, búsqueda por texto, filtro por tipo, período y
// estado vacío con filtros. Siembra 13 eventos en el registro de la organización de la corrida (12 de los últimos días y 1 de hace 20) y
// no toca ninguna otra. Requiere el stack local (`pnpm dev:supabase`) y la web servida; siembra con la API admin desde Node. Sin
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY se omite: ver docs/e2e-app.md.

const password = 'Correcta-12345!'
const haceDias = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString()

async function ingresar(page: Page, correo: string) {
  await page.goto('/login')
  await escribir(page, page.getByLabel('Correo'), correo)
  await escribir(page, page.getByLabel('Contraseña'), password)
  await clic(page, page.getByRole('button', { name: 'Ingresar' }))
  await expect(page).not.toHaveURL(/\/login/)
}

test.describe('Actividad · filtros y búsqueda (F-AUD-01)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('el Administrador filtra por texto, tipo y período, y ve el estado vacío con filtros', async ({ page }) => {
    const sufijo = randomUUID().slice(0, 8)
    const correo = `admin-act-${sufijo}@example.com`
    const marca = `marca${sufijo}`
    let orgId: string | undefined
    let userId: string | undefined
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E actividad ${sufijo}` })
      orgId = org.id
      userId = await altaUsuario(correo)
      await rest('usuarios_organizacion', { user_id: userId, organizacion_id: org.id, rol_id: 'administrador' })
      const evento = (tipo: string, detalle: string, dias: number) => ({
        organizacion_id: org.id, actor_id: userId, actor_nombre: 'Ana Admin', tipo, detalle, creado_en: haceDias(dias), valor_anterior: {}, valor_nuevo: {},
      })
      await rest('registro_actividad', [
        ...Array.from({ length: 11 }, (_, i) => evento('usuario.rol_cambiado', `Cambió el rol número ${i + 1} de ${sufijo}`, 1 + (i % 3))),
        evento('usuario.removido', `Quitó a ${marca} de la organización`, 2),
        evento('usuario.suspendido', `Suspendió a una persona antigua de ${sufijo}`, 20),
      ])

      await ingresar(page, correo)
      await page.goto('/actividad')
      await expect(page.getByRole('heading', { name: 'Actividad', exact: true })).toBeVisible()

      // Período por defecto (últimos 7 días): los 12 eventos recientes; el de hace 20 días queda afuera.
      await expect(page.getByText('12 eventos')).toBeVisible()

      // Búsqueda por texto.
      await escribir(page, page.getByLabel('Buscar en la actividad'), marca)
      await expect(page.getByText('1 evento', { exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: `Ver detalle: Quitó a ${marca} de la organización` })).toBeVisible()
      await escribir(page, page.getByLabel('Buscar en la actividad'), '')
      await expect(page.getByText('12 eventos')).toBeVisible()

      // Filtro por tipo.
      await page.getByLabel('Tipo').click()
      await page.getByRole('option', { name: 'Usuario removido' }).click()
      await expect(page.getByText('1 evento', { exact: true })).toBeVisible()
      await page.getByLabel('Tipo').click()
      await page.getByRole('option', { name: 'Todos los tipos' }).click()
      await expect(page.getByText('12 eventos')).toBeVisible()

      // Período: con 30 días entra el evento antiguo.
      await page.getByLabel('Período').click()
      await page.getByRole('option', { name: 'Últimos 30 días' }).click()
      await expect(page.getByText('13 eventos')).toBeVisible()

      // Sin resultados: estado vacío que explica que hay filtros.
      await escribir(page, page.getByLabel('Buscar en la actividad'), `no-existe-${sufijo}`)
      await expect(page.getByText('No hay actividad con esos filtros.')).toBeVisible()
    } finally {
      if (orgId) {
        await borrar(`registro_actividad?organizacion_id=eq.${orgId}`)
        await borrar(`usuarios_organizacion?organizacion_id=eq.${orgId}`)
        await borrar(`organizaciones?id=eq.${orgId}`)
      }
      if (userId) await borrarUsuario(userId)
    }
  })
})
