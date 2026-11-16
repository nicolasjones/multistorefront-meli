import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import type { Page } from '@playwright/test'
import { expect, test } from './fixture'
import { rotulo } from './visible'
import { altaUsuario, borrarUsuario, limpiarOrganizacion, rest, serviceKey, url } from './soporte/fixtures'

// Recorrido con sesión de Clientes (F-CLI-01/02/04, SC-001): alta desde la UI, búsqueda y exportación a Excel con el
// registro de la actividad `clientes.exportados`. Todo por la UI y las RPC de la web: el único dato sembrado es la
// organización, el usuario y su rol. Requiere el stack local y la web servida; sin SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY se omite: ver docs/e2e-app.md.

const password = 'Correcta-12345!'

async function ingresar(page: Page, correo: string) {
  await page.goto('/login')
  await page.getByLabel('Correo').fill(correo)
  await page.getByLabel('Contraseña').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

test.describe('Clientes · alta, búsqueda y exportación', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')
  test.setTimeout(180000)

  test('el Administrador da de alta un cliente, lo encuentra buscándolo y lo exporta a Excel', async ({ page }) => {
    const sufijo = randomUUID().slice(0, 8)
    const correo = `admin-cli-${sufijo}@example.com`
    const nombre = `Cliente Recorrido ${sufijo}`
    let orgId: string | undefined
    let userId: string | undefined
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E clientes ${sufijo}` })
      orgId = org.id
      userId = await altaUsuario(correo)
      await rest('usuarios_organizacion', { user_id: userId, organizacion_id: org.id, rol_id: 'administrador' })

      await rotulo(page, 'Ingresa como Administrador')
      await ingresar(page, correo)

      await rotulo(page, 'Da de alta un cliente')
      await page.goto('/clientes/create')
      await page.getByLabel('Nombre o razón social').fill(nombre)
      await page.getByLabel('Correo', { exact: true }).fill(`cli-${sufijo}@example.com`)
      await page.getByRole('button', { name: 'Crear cliente' }).click()
      await expect(page).toHaveURL(/\/clientes\/show\//)
      await expect(page.getByText(nombre).first()).toBeVisible()

      await rotulo(page, 'Lo busca en el listado')
      await page.goto('/clientes')
      await page.getByLabel('Buscar clientes').fill(sufijo)
      await expect(page.getByRole('button', { name: `Ver ${nombre}` }).or(page.getByRole('link', { name: `Ver ${nombre}` }))).toBeVisible()

      await rotulo(page, 'Exporta el resultado a Excel')
      await page.getByRole('button', { name: 'Exportar', exact: true }).click()
      const dialogo = page.getByRole('dialog', { name: 'Exportar clientes' })
      await expect(dialogo).toContainText('1 cliente')
      const [descarga] = await Promise.all([
        page.waitForEvent('download'),
        dialogo.getByRole('button', { name: 'Descargar archivo' }).click(),
      ])
      expect(descarga.suggestedFilename()).toMatch(/^clientes-\d{4}-\d{2}-\d{2}\.xlsx$/)
      const ruta = await descarga.path()
      const partes = unzipSync(new Uint8Array(readFileSync(ruta)))
      const texto = Object.entries(partes)
        .filter(([n]) => n.endsWith('.xml'))
        .map(([, bytes]) => strFromU8(bytes))
        .join('\n')
      expect(texto).toContain(nombre)
      await expect(dialogo.getByText('Listo: el archivo se descargó.')).toBeVisible()
      await dialogo.getByRole('button', { name: 'Cerrar' }).last().click()

      await rotulo(page, 'La exportación queda en la actividad')
      await page.goto('/actividad')
      await page.getByLabel('Buscar en la actividad').fill('Exportó 1 cliente')
      await expect(page.getByText(/Exportó 1 cliente a Excel/).first()).toBeVisible()
    } finally {
      if (orgId) await limpiarOrganizacion(orgId)
      if (userId) await borrarUsuario(userId)
    }
  })
})
