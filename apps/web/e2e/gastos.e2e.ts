import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { expect, test } from './fixture'
import { rotulo } from './visible'
import { altaUsuario, borrar, borrarUsuario, rest, serviceKey, url } from './soporte/fixtures'

// Recorrido de Gastos (Administración → Gastos): el Administrador carga un gasto en una tienda, lo ve en el listado y en el
// total del período, lo anula con motivo y comprueba que deja de sumar y que queda visible con «Mostrar anulados». Requiere el
// stack local (`pnpm dev:supabase`) y la web servida; siembra con la API admin desde Node (la service-role key nunca llega al
// navegador). Los gastos NO se siembran por REST: se cargan por la pantalla, que escribe con las RPC `guardar_gasto` y
// `anular_gasto`. Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se omite: ver docs/e2e-app.md.

const password = 'Correcta-12345!'

async function ingresar(page: Page, correo: string) {
  await page.goto('/login')
  await page.getByLabel('Correo').fill(correo)
  await page.getByLabel('Contraseña').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

test.describe('Gastos de la empresa', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-982:T015] cargar un gasto, verlo en el total del mes y anularlo con motivo', async ({ page }) => {
    test.setTimeout(120_000)
    const sufijo = randomUUID().slice(0, 8)
    const correo = `admin-gastos-${sufijo}@example.com`
    const tienda = `Tienda Gastos ${sufijo}`
    const detalle = `Internet ${sufijo}`
    const motivo = `Cargado dos veces ${sufijo}`

    let orgId: string | undefined
    const ids: string[] = []
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E gastos ${sufijo}` })
      orgId = org.id
      await rest('empresas', [{ organizacion_id: org.id, nombre: tienda }], 'dominio')
      const idAdmin = await altaUsuario(correo)
      ids.push(idAdmin)
      await rest('usuarios_organizacion', [{ user_id: idAdmin, organizacion_id: org.id, rol_id: 'administrador' }])

      await rotulo(page, 'Ingresa como Administrador')
      await ingresar(page, correo)
      await rotulo(page, 'Abre Gastos')
      await page.goto('/gastos')
      await expect(page.getByRole('heading', { name: 'Gastos' })).toBeVisible()
      // Sin gastos: el total del período arranca en cero.
      await expect(page.getByText('Sin gastos en el período')).toBeVisible()

      await rotulo(page, 'Carga un gasto de Servicios en la tienda')
      await page.getByRole('button', { name: 'Nuevo gasto' }).first().click()
      const nuevo = page.getByRole('dialog', { name: 'Nuevo gasto' })
      await nuevo.getByRole('combobox', { name: /Concepto/ }).click()
      await page.getByRole('option', { name: 'Servicios' }).click()
      await nuevo.getByLabel('Detalle').fill(detalle)
      await nuevo.getByLabel(/^Importe/).fill('36800,50')
      const casilla = nuevo.getByRole('checkbox', { name: tienda })
      if (!(await casilla.isChecked())) await casilla.check()
      await nuevo.getByRole('button', { name: 'Guardar gasto' }).click()
      await expect(nuevo).toBeHidden()
      await expect(page.getByText('Gasto cargado.')).toBeVisible()

      await rotulo(page, 'El gasto aparece en el listado y en el total del mes')
      const tabla = page.getByRole('table', { name: 'Gastos' })
      await expect(tabla.getByText(detalle)).toBeVisible()
      await expect(page.getByText(/36\.800,50/).first()).toBeVisible()
      const desglose = page.getByRole('list', { name: 'Desglose por concepto' })
      await expect(desglose.getByText('Servicios · fijo')).toBeVisible()

      await rotulo(page, 'Anula el gasto con un motivo')
      await page.getByRole('button', { name: /^Anular gasto de Servicios/ }).click()
      const anular = page.getByRole('dialog', { name: 'Anular gasto' })
      await anular.getByLabel(/Motivo/).fill(motivo)
      await anular.getByRole('button', { name: 'Anular gasto' }).click()
      await expect(anular).toBeHidden()
      await expect(page.getByText('Gasto anulado.')).toBeVisible()

      // Deja de contar: el listado queda vacío y el total vuelve a cero.
      await expect(page.getByText('Sin gastos en el período')).toBeVisible()
      await expect(page.getByText(/36\.800,50/)).toHaveCount(0)

      await rotulo(page, 'Con «Mostrar anulados» sigue visible, con su motivo')
      await page.getByRole('checkbox', { name: 'Mostrar anulados' }).check()
      await expect(tabla.getByText(detalle)).toBeVisible()
      await expect(tabla.getByText('Anulado')).toBeVisible()
      await expect(tabla.getByText(`Motivo: ${motivo}`)).toBeVisible()
      // Un gasto anulado no se puede editar ni volver a anular.
      await expect(page.getByRole('button', { name: /^Editar gasto/ })).toHaveCount(0)
    } finally {
      // Limpieza: el Supabase local no acumula organizaciones ni usuarios sembrados (los gastos caen con la empresa).
      if (orgId) {
        await borrar(`usuarios_organizacion?organizacion_id=eq.${orgId}`)
        await borrar(`empresas?organizacion_id=eq.${orgId}`, 'dominio')
        await borrar(`organizaciones?id=eq.${orgId}`)
      }
      for (const id of ids) await borrarUsuario(id)
    }
  })
})
