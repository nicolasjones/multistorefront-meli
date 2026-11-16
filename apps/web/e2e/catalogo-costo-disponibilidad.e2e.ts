import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { UPSERT_FUSIONAR, altaUsuario, borrar, borrarUsuario, rest, serviceKey, url } from './soporte/fixtures'

// Cierre de MSF-179 (T022, FR-016, SC-005): recorrido Administrador vs Operador del
// catálogo: costo (solo con acceso a Rentabilidad), disponibilidad y escaneo de código de barras.
// Requiere el stack local (`pnpm dev:supabase`) y la web servida; siembra con la
// API admin desde Node (la service-role key nunca llega al navegador). Sin
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se omite.

const password = 'Correcta-12345!'

async function ingresar(page: Page, correo: string) {
  await page.goto('/login')
  await page.getByLabel('Correo').fill(correo)
  await page.getByLabel('Contraseña').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

test.describe('Catálogo: costo, disponibilidad y escaneo (MSF-179, FR-016)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('el Administrador ve el costo y el Operador no; ambos ven la disponibilidad y escanean', async ({ browser }) => {
    const sufijo = randomUUID().slice(0, 8)
    const correoAdmin = `admin-catalogo-${sufijo}@example.com`
    const correoOperador = `operador-catalogo-${sufijo}@example.com`
    const conStock = `Producto con stock ${sufijo}`
    const aPedido = `Producto a pedido ${sufijo}`
    const codigoBarras = String(Math.floor(Math.random() * 9e12) + 1e12)

    let orgId: string | undefined
    const ids: string[] = []
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E catálogo ${sufijo}` })
      orgId = org.id
      const idAdmin = await altaUsuario(correoAdmin)
      ids.push(idAdmin)
      const idOperador = await altaUsuario(correoOperador)
      ids.push(idOperador)
      await rest('usuarios_organizacion', [
        { user_id: idAdmin, organizacion_id: org.id, rol_id: 'administrador' },
        { user_id: idOperador, organizacion_id: org.id, rol_id: 'operador' },
      ])
      const [p1, p2] = await rest<{ id: string }>('productos', [
        { organizacion_id: org.id, nombre: conStock, sku: `E2E-S-${sufijo}`, precio_lista: 50, codigo_barras: codigoBarras, disponibilidad_manual: null },
        { organizacion_id: org.id, nombre: aPedido, sku: `E2E-P-${sufijo}`, precio_lista: 40, codigo_barras: null, disponibilidad_manual: 'a_pedido' },
      ], 'dominio')
      await rest('producto_costos', [
        { producto_id: p1.id, organizacion_id: org.id, costo: 12.5 },
        { producto_id: p2.id, organizacion_id: org.id, costo: 7 },
      ], 'dominio')
      // El disparador `productos_crear_existencias` ya creó la fila: se actualiza.
      await rest('existencias?on_conflict=producto_id', { producto_id: p1.id, organizacion_id: org.id, cantidad: 4 }, 'dominio', UPSERT_FUSIONAR)

      // Administrador: columna Costo con el valor sembrado.
      const ctxAdmin = await browser.newContext()
      const admin = await ctxAdmin.newPage()
      await ingresar(admin, correoAdmin)
      await admin.goto('/productos')
      await expect(admin.getByRole('columnheader', { name: 'Costo' })).toBeVisible()
      const filaAdmin = admin.getByRole('row', { name: new RegExp(conStock) })
      await expect(filaAdmin).toContainText('12,50')
      await expect(filaAdmin).toContainText('Stock')
      await expect(admin.getByRole('row', { name: new RegExp(aPedido) })).toContainText('A pedido')
      await ctxAdmin.close()

      // Operador: sin columna Costo (ni el valor en la página), pero con disponibilidad y escaneo.
      const ctxOperador = await browser.newContext()
      const operador = await ctxOperador.newPage()
      await ingresar(operador, correoOperador)
      await operador.goto('/productos')
      await expect(operador.getByRole('row', { name: new RegExp(conStock) })).toBeVisible()
      await expect(operador.getByRole('columnheader', { name: 'Costo' })).toHaveCount(0)
      await expect(operador.getByText('12,50')).toHaveCount(0)
      await expect(operador.getByRole('row', { name: new RegExp(aPedido) })).toContainText('A pedido')

      await operador.getByLabel('Disponibilidad').selectOption({ label: 'A pedido' })
      await expect(operador.getByRole('row', { name: new RegExp(aPedido) })).toBeVisible()
      await expect(operador.getByRole('row', { name: new RegExp(conStock) })).toHaveCount(0)
      await operador.getByLabel('Disponibilidad').selectOption({ label: 'Todos' })

      const buscador = operador.getByLabel('Buscar por nombre, SKU o código de barras')
      await buscador.fill(codigoBarras)
      await buscador.press('Enter')
      await expect(operador.getByRole('row', { name: new RegExp(conStock) })).toBeVisible()
      await expect(operador.getByRole('row', { name: new RegExp(aPedido) })).toHaveCount(0)
      await expect(buscador).toBeFocused()
      await ctxOperador.close()
    } finally {
      // Limpieza: el Supabase local no acumula organizaciones ni usuarios sembrados.
      if (orgId) {
        await borrar(`usuarios_organizacion?organizacion_id=eq.${orgId}`)
        await borrar(`organizaciones?id=eq.${orgId}`)
      }
      for (const id of ids) await borrarUsuario(id)
    }
  })
})
