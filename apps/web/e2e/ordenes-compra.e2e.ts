import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from './fixture'

// F-PRV-09 (MSF-454, SC-003): orden de compra a proveedor. El administrador entra a
// Stock · Órdenes de compra, crea una orden para el proveedor de un producto que está en
// alerta de reposición, la ve en el listado, la marca como recibida y el estado cambia.
// Requiere el stack local (`pnpm dev:supabase`) y la web servida; siembra con la API admin
// desde Node (la service-role key nunca llega al navegador). Sin SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY el archivo se omite: ver docs/e2e-app.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de órdenes de compra: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
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

// El mínimo y la cantidad son de stock: la app solo escribe por RPC, la siembra lo hace con
// service-role (deja el producto en alerta de reposición).
async function actualizar(ruta: string, cuerpo: unknown, esquema: string) {
  const r = await fetch(`${url}/rest/v1/${ruta}`, {
    method: 'PATCH',
    headers: cabeceras({ 'content-profile': esquema }),
    body: JSON.stringify(cuerpo),
  })
  if (!r.ok) throw new Error(`REST PATCH ${ruta}: ${r.status} ${await r.text()}`)
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

async function borrar(ruta: string, esquema = 'public') {
  const r = await fetch(`${url}/rest/v1/${ruta}`, {
    method: 'DELETE',
    headers: cabeceras({ 'content-profile': esquema }),
  })
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

test.describe('Órdenes de compra a proveedores (MSF-454)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-454:T012] crea una orden desde el listado de reposición y la marca como recibida', async ({ page }) => {
    const sufijo = randomUUID().slice(0, 8)
    const correo = `admin-ordenes-${sufijo}@example.com`
    const empresa = `Tienda órdenes ${sufijo}`
    const proveedor = `Proveedor órdenes ${sufijo}`
    const producto = `Producto en alerta ${sufijo}`

    let orgId: string | undefined
    let idUsuario: string | undefined
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E órdenes ${sufijo}` })
      orgId = org.id
      idUsuario = await altaUsuario(correo)
      await rest('usuarios_organizacion', [{ user_id: idUsuario, organizacion_id: org.id, rol_id: 'administrador' }])
      await rest('empresas', { organizacion_id: org.id, nombre: empresa, activa: true }, 'dominio')
      const [prov] = await rest<{ id: string }>('proveedores', {
        organizacion_id: org.id, razon_social: proveedor, cuit: '20123456786', activo: true,
      }, 'dominio')
      const [prod] = await rest<{ id: string }>('productos', {
        organizacion_id: org.id, nombre: producto, sku: `ORD-${sufijo}`, precio_lista: 50, proveedor_id: prov.id,
      }, 'dominio')
      // El producto queda en alerta de reposición (disponible 0 <= mínimo 10).
      await actualizar(`existencias?producto_id=eq.${prod.id}`, { minimo: 10, cantidad: 0 }, 'dominio')

      await ingresar(page, correo)
      await page.goto('/stock/ordenes-compra')
      await expect(page.getByRole('heading', { name: 'Órdenes de compra' })).toBeVisible()

      // Sin viewports rotos: la pantalla no desborda a 320, 768 ni 1440 px.
      for (const ancho of [320, 768, 1440]) {
        await page.setViewportSize({ width: ancho, height: 900 })
        const desborda = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
        expect(desborda, `desborde horizontal a ${ancho}px`).toBe(false)
      }
      await page.setViewportSize({ width: 1920, height: 1080 })

      // Alta: el proveedor es el del producto en alerta y la cantidad sugerida es el mínimo.
      await page.getByRole('button', { name: 'Nueva orden de compra' }).click()
      const alta = page.getByRole('dialog', { name: 'Nueva orden de compra' })
      await alta.getByLabel('Proveedor').click()
      await page.getByRole('option', { name: proveedor }).click()
      await expect(alta.getByText(producto)).toBeVisible()
      await alta.getByRole('checkbox').check()
      await expect(alta.getByText('Sugerido: 10')).toBeVisible()
      await alta.getByRole('button', { name: 'Crear orden de compra' }).click()
      await expect(page.getByText('Orden de compra creada')).toBeVisible()

      // La orden aparece en el listado, con su estado y sus unidades.
      const tabla = page.getByRole('table', { name: 'Órdenes de compra a proveedores' })
      await expect(tabla.getByText(proveedor)).toBeVisible()
      await expect(tabla.getByText('Emitida')).toBeVisible()

      // Detalle: la orden trae su línea y se puede marcar como recibida.
      await tabla.getByRole('button', { name: 'Ver' }).first().click()
      const detalle = page.getByRole('dialog')
      await expect(detalle.getByText(producto)).toBeVisible()
      await detalle.getByRole('button', { name: 'Marcar como recibida' }).click()
      await expect(page.getByText('Orden marcada como recibida')).toBeVisible()
      await expect(detalle.getByText('Recibida')).toBeVisible()
    } finally {
      if (orgId) {
        await borrar(`usuarios_organizacion?organizacion_id=eq.${orgId}`)
        await borrar(`organizaciones?id=eq.${orgId}`)
      }
      if (idUsuario) await borrarUsuario(idUsuario)
    }
  })
})
