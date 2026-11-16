import { randomUUID } from 'node:crypto'
import { abrirContextoGrabado, cerrarContextoGrabado, expect, test } from './fixture'
import { altaUsuario, borrar, borrarUsuario, rest, serviceKey, url } from './soporte/fixtures'

// Cierre de MSF-192 (T041, SC-013): los cuatro reportes de la épica («Ventas reales», «Productos más consultados»,
// «Ventas por período y canal» y los ya existentes de «Reportes de ventas») y la sección «Costos adicionales», con
// Administrador, Administración y Operador/Consulta. Requiere el stack local (`pnpm dev:supabase`) y la web servida;
// siembra con la API admin desde Node (la service-role key nunca llega al navegador). Los tableros de Superset no se
// montan acá (necesitan un Superset real): el marco, la pestaña y el acceso salen de la pantalla y de la base.
// Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se omite: ver docs/e2e-app.md.

const password = 'Correcta-12345!'

const SIN_ACCESO = 'No tenés acceso a esta sección'
const PESTANAS_REPORTES = ['Más vendidos', 'Ranking de clientes', 'Productos más consultados', 'Ventas por período y canal']

test.describe('Rentabilidad real y reportes de ventas con los tres roles (MSF-192, SC-013)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-741:T041] Administrador y Administración ven los reportes y los costos; Operador y Consulta quedan restringidos', async ({ browser }, testInfo) => {
    test.setTimeout(90_000) // recorre los reportes con cuatro roles, cada uno en su propia sesión
    const sufijo = randomUUID().slice(0, 8)
    const roles = {
      administrador: `admin-rr-${sufijo}@example.com`,
      administracion: `administracion-rr-${sufijo}@example.com`,
      operador: `operador-rr-${sufijo}@example.com`,
      consulta: `consulta-rr-${sufijo}@example.com`,
    } as const

    let orgId: string | undefined
    const ids: string[] = []
    const ingresar = async (page: import('@playwright/test').Page, correo: string) => {
      await page.goto('/login')
      await page.getByLabel('Correo').fill(correo)
      await page.getByLabel('Contraseña').fill(password)
      await page.getByRole('button', { name: 'Ingresar' }).click()
      await expect(page).not.toHaveURL(/\/login/)
    }
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E rentabilidad real ${sufijo}` })
      orgId = org.id
      const asignaciones: Array<{ user_id: string; organizacion_id: string; rol_id: string }> = []
      for (const [rol, correo] of Object.entries(roles)) {
        const id = await altaUsuario(correo)
        ids.push(id)
        asignaciones.push({ user_id: id, organizacion_id: org.id, rol_id: rol })
      }
      await rest('usuarios_organizacion', asignaciones)
      await rest('empresas', { organizacion_id: org.id, nombre: `Empresa rentabilidad real ${sufijo}`, activa: true }, 'dominio')

      // Administrador y Administración leen todo; solo el Administrador edita los costos adicionales.
      for (const rol of ['administrador', 'administracion'] as const) {
        const { contexto, page } = await abrirContextoGrabado(browser, testInfo, rol)
        try {
          await ingresar(page, roles[rol])
          await page.goto('/rentabilidad/ventas-reales')
          await expect(page.getByRole('tab', { name: 'Ventas reales' })).toBeVisible()
          await expect(page.getByRole('heading', { name: SIN_ACCESO })).toHaveCount(0)

          await page.goto('/rentabilidad/costos')
          await expect(page.getByRole('heading', { name: SIN_ACCESO })).toHaveCount(0)
          await expect(page.getByRole('tab', { name: 'Costos adicionales' })).toBeVisible()

          await page.goto('/ventas/reportes')
          await expect(page.getByRole('heading', { name: 'Reportes de ventas' })).toBeVisible()
          for (const pestana of PESTANAS_REPORTES) await expect(page.getByRole('tab', { name: pestana })).toBeVisible()
          await page.getByRole('tab', { name: 'Productos más consultados' }).click()
          await expect(page.getByRole('tab', { name: 'Productos más consultados', selected: true })).toBeVisible()
          await page.getByRole('tab', { name: 'Ventas por período y canal' }).click()
          await expect(page.getByRole('tab', { name: 'Ventas por período y canal', selected: true })).toBeVisible()
        } finally {
          await cerrarContextoGrabado(contexto, page, testInfo)
        }
      }

      // Operador y Consulta: acceso restringido en las cinco superficies.
      for (const rol of ['operador', 'consulta'] as const) {
        const { contexto, page } = await abrirContextoGrabado(browser, testInfo, rol)
        try {
          await ingresar(page, roles[rol])
          for (const ruta of ['/rentabilidad/ventas-reales', '/rentabilidad/costos', '/ventas/reportes']) {
            await page.goto(ruta)
            await expect(page.getByRole('heading', { name: SIN_ACCESO })).toBeVisible()
          }
          await expect(page.getByRole('tab', { name: 'Ventas por período y canal' })).toHaveCount(0)
        } finally {
          await cerrarContextoGrabado(contexto, page, testInfo)
        }
      }
    } finally {
      if (orgId) {
        await borrar(`empresas?organizacion_id=eq.${orgId}`, 'dominio')
        await borrar(`usuarios_organizacion?organizacion_id=eq.${orgId}`)
        await borrar(`organizaciones?id=eq.${orgId}`)
      }
      for (const id of ids) await borrarUsuario(id)
    }
  })
})
