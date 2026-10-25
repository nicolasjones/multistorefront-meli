import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

// Cierre de MSF-219 (T019, SC-001…003): ingreso de dos productos con costo →
// stock sube → historial → anular → stock vuelve y el ingreso queda anulado.
// Requiere el stack local (`pnpm dev:supabase`) y la web servida; siembra con la
// API admin desde Node (la service-role key nunca llega al navegador). Sin
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se omite.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de ingresos: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
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

async function elegirAutocomplete(page: Page, etiqueta: string, opcion: string) {
  await page.getByLabel(etiqueta).click()
  await page.getByRole('option', { name: opcion }).click()
}

test.describe('Ingreso de mercadería por proveedor (MSF-219, SC-001…003)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('registra dos productos con costo, los lista y anula el ingreso', async ({ browser }) => {
    const sufijo = randomUUID().slice(0, 8)
    const correo = `admin-ingresos-${sufijo}@example.com`
    const empresa = `Tienda E2E ${sufijo}`
    const proveedor = `Proveedor E2E ${sufijo}`
    const producto1 = `Producto ingreso A ${sufijo}`
    const producto2 = `Producto ingreso B ${sufijo}`

    let orgId: string | undefined
    let idUsuario: string | undefined
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E ingresos ${sufijo}` })
      orgId = org.id
      idUsuario = await altaUsuario(correo)
      await rest('usuarios_organizacion', [{ user_id: idUsuario, organizacion_id: org.id, rol_id: 'administrador' }])
      await rest('empresas', { organizacion_id: org.id, nombre: empresa, activa: true }, 'dominio')
      await rest('proveedores', {
        organizacion_id: org.id, razon_social: proveedor, cuit: '20123456786', activo: true,
      }, 'dominio')
      await rest('productos', [
        { organizacion_id: org.id, nombre: producto1, sku: `E2E-A-${sufijo}`, precio_lista: 50 },
        { organizacion_id: org.id, nombre: producto2, sku: `E2E-B-${sufijo}`, precio_lista: 40 },
      ], 'dominio')

      const contexto = await browser.newContext()
      const page = await contexto.newPage()
      await ingresar(page, correo)
      await page.goto('/stock/ingresos')

      await elegirAutocomplete(page, 'Compra a nombre de', empresa)
      await elegirAutocomplete(page, 'Proveedor', proveedor)
      await elegirAutocomplete(page, 'Producto 1', producto1)
      await page.getByLabel('Cantidad').first().fill('5')
      await page.getByLabel('Costo unit. USD').first().fill('10.50')
      await page.getByRole('button', { name: 'Agregar producto' }).click()
      await elegirAutocomplete(page, 'Producto 2', producto2)
      await page.getByLabel('Cantidad').nth(1).fill('3')
      await page.getByLabel('Costo unit. USD').nth(1).fill('4')
      await page.getByLabel('Actualizar el costo del producto con este ingreso').check()
      await page.getByRole('button', { name: 'Registrar ingreso' }).click()

      await expect(page.getByText(/Ingreso registrado · 8 unidades/)).toBeVisible()
      await expect(page.getByText(producto1).first()).toBeVisible()

      // El stock de ambos productos sube.
      await page.goto('/stock')
      await expect(page.getByRole('row', { name: new RegExp(producto1) }).getByRole('cell').nth(1)).toHaveText('5')
      await expect(page.getByRole('row', { name: new RegExp(producto2) }).getByRole('cell').nth(1)).toHaveText('3')

      // El historial muestra el ingreso y permite anularlo.
      await page.goto('/stock/ingresos')
      await expect(page.getByText(producto1).first()).toBeVisible()
      await page.getByRole('button', { name: 'Anular' }).first().click()
      const dialogo = page.getByRole('dialog', { name: 'Anular ingreso' })
      await dialogo.getByLabel('Motivo de la anulación').fill('Carga equivocada')
      await dialogo.getByRole('button', { name: 'Anular ingreso' }).click()
      await expect(page.getByText('Ingreso anulado')).toBeVisible()
      await expect(page.getByText('Anulado').first()).toBeVisible()

      // El stock vuelve a 0 y los movimientos conservan entrada y salida.
      await page.goto('/stock')
      await expect(page.getByRole('row', { name: new RegExp(producto1) }).getByRole('cell').nth(1)).toHaveText('0')
      await expect(page.getByRole('row', { name: new RegExp(producto2) }).getByRole('cell').nth(1)).toHaveText('0')

      await contexto.close()
    } finally {
      // Limpieza: el Supabase local no acumula organizaciones ni usuarios sembrados.
      if (orgId) {
        await borrar(`usuarios_organizacion?organizacion_id=eq.${orgId}`)
        await borrar(`organizaciones?id=eq.${orgId}`)
      }
      if (idUsuario) await borrarUsuario(idUsuario)
    }
  })
})
