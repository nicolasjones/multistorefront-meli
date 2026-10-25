import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

// Cierre de MSF-179 (T022, FR-016, SC-005): recorrido Administrador vs Operador del
// catálogo: costo (solo con acceso a Rentabilidad), disponibilidad y escaneo de código de barras.
// Requiere el stack local (`pnpm dev:supabase`) y la web servida; siembra con la
// API admin desde Node (la service-role key nunca llega al navegador). Sin
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se omite.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de catálogo: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
}

const cabeceras = (extra: Record<string, string> = {}) => ({
  apikey: serviceKey ?? '',
  authorization: `Bearer ${serviceKey}`,
  'content-type': 'application/json',
  ...extra,
})

async function rest<T>(ruta: string, cuerpo: unknown, esquema = 'public'): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${ruta}`, {
    method: 'POST',
    headers: cabeceras({ prefer: 'return=representation', 'content-profile': esquema }),
    body: JSON.stringify(cuerpo),
  })
  if (!r.ok) throw new Error(`REST ${ruta}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T[]
}

async function altaUsuario(correo: string): Promise<string> {
  const r = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: cabeceras(),
    body: JSON.stringify({ email: correo, password, email_confirm: true }),
  })
  if (!r.ok) throw new Error(`alta de ${correo}: ${r.status} ${await r.text()}`)
  return ((await r.json()) as { id: string }).id
}

async function borrar(ruta: string) {
  const r = await fetch(`${url}/rest/v1/${ruta}`, { method: 'DELETE', headers: cabeceras() })
  if (!r.ok) console.warn(`limpieza E2E: DELETE ${ruta} → ${r.status}`)
}

async function borrarUsuario(id: string) {
  const r = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: cabeceras() })
  if (!r.ok) console.warn(`limpieza E2E: baja de usuario ${id} → ${r.status}`)
}

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
        { organizacion_id: org.id, nombre: conStock, sku: `E2E-S-${sufijo}`, precio_lista: 50, codigo_barras: codigoBarras },
        { organizacion_id: org.id, nombre: aPedido, sku: `E2E-P-${sufijo}`, precio_lista: 40, disponibilidad_manual: 'a_pedido' },
      ], 'dominio')
      await rest('producto_costos', [
        { producto_id: p1.id, organizacion_id: org.id, costo: 12.5 },
        { producto_id: p2.id, organizacion_id: org.id, costo: 7 },
      ], 'dominio')
      await rest('existencias', { producto_id: p1.id, organizacion_id: org.id, cantidad: 4 }, 'dominio')

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
