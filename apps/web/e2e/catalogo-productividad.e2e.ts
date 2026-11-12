import { randomUUID } from 'node:crypto'
import { expect, test } from './fixture'
import type { Page } from '@playwright/test'

// MSF-218 · F-CAT-12 (SC-002, parte E2E): un Operador marca 3 productos en el listado, los mueve de categoría,
// los desactiva y les agrega una empresa. Requiere el stack local (`pnpm dev:supabase`). Siembra con la API admin
// desde Node (la service-role key nunca llega al navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el
// archivo se omite: ver docs/e2e-app.md.
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

async function leer<T>(ruta: string, esquema = 'public'): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${ruta}`, { headers: cabeceras({ 'accept-profile': esquema }) })
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

test.describe('Catálogo · productividad (MSF-218, F-CAT-12)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-392:T010] el Operador mueve, desactiva y asigna una empresa a 3 productos', async ({ page }) => {
    test.setTimeout(180_000) // recorrido largo de varios pasos y roles: el tope por defecto (30 s) no alcanza
    const sufijo = randomUUID().slice(0, 8)
    const correo = `operador-masiva-${sufijo}@example.com`
    const nombres = [1, 2, 3].map((n) => `Masivo ${n} ${sufijo}`)
    const categoria = `Joysticks ${sufijo}`
    const empresa = `Tienda masiva ${sufijo}`

    let orgId: string | undefined
    const usuarios: string[] = []
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E masiva ${sufijo}` })
      orgId = org.id
      const idOperador = await altaUsuario(correo)
      usuarios.push(idOperador)
      await rest('usuarios_organizacion', { user_id: idOperador, organizacion_id: org.id, rol_id: 'operador' })
      const [emp] = await rest<{ id: string }>('empresas', { organizacion_id: org.id, nombre: empresa }, 'dominio')
      // Fuera del Administrador, cada persona ve solo las empresas que se le asignan (permisos por empresa).
      await rest('usuarios_empresas', { user_id: idOperador, empresa_id: emp.id, organizacion_id: org.id, rol_id: 'operador' })
      const [cat] = await rest<{ id: string }>('categorias', { organizacion_id: org.id, nombre: categoria }, 'dominio')
      const productos = await rest<{ id: string }>(
        'productos',
        nombres.map((nombre, i) => ({ organizacion_id: org.id, nombre, sku: `E2E-M${i}-${sufijo}`, precio_lista: 10 })),
        'dominio',
      )
      const ids = productos.map((p) => p.id).join(',')

      await ingresar(page, correo)
      await page.goto('/productos')
      await page.getByLabel('Buscar por nombre, SKU o código de barras').fill(sufijo)
      for (const nombre of nombres) await expect(page.getByRole('row', { name: new RegExp(nombre) })).toBeVisible()
      await page.getByRole('checkbox', { name: 'Seleccionar todos' }).check()
      await expect(page.getByText('3 seleccionados')).toBeVisible()

      // Mover de categoría
      await page.getByRole('button', { name: 'Mover de categoría' }).click()
      await page.getByRole('dialog', { name: 'Mover de categoría' }).getByRole('button', { name: categoria }).click()
      await expect(page.getByText(`3 productos movidos a ${categoria}`)).toBeVisible()
      expect(await leer<{ id: string }>(`productos?id=in.(${ids})&categoria_id=eq.${cat.id}&select=id`, 'dominio')).toHaveLength(3)

      // Desactivar
      await page.getByRole('checkbox', { name: 'Seleccionar todos' }).check()
      await page.getByRole('button', { name: 'Cambiar estado' }).click()
      const estado = page.getByRole('dialog', { name: 'Cambiar estado' })
      await estado.getByRole('radio', { name: 'Desactivar' }).check()
      await estado.getByRole('button', { name: 'Desactivar 3 productos' }).click()
      await expect(page.getByText('3 productos desactivados')).toBeVisible()
      expect(await leer<{ id: string }>(`productos?id=in.(${ids})&activo=eq.false&select=id`, 'dominio')).toHaveLength(3)

      // Asignar empresa
      await page.getByRole('checkbox', { name: 'Seleccionar todos' }).check()
      await page.getByRole('button', { name: 'Cambiar empresas' }).click()
      const empresas = page.getByRole('dialog', { name: 'Cambiar empresas' })
      await empresas.getByRole('group', { name: 'Agregar a' }).getByRole('checkbox', { name: empresa }).check()
      await empresas.getByRole('button', { name: 'Aplicar a 3 productos' }).click()
      await expect(page.getByText('3 productos actualizados')).toBeVisible()
      expect(await leer<{ producto_id: string }>(`producto_empresa?producto_id=in.(${ids})&empresa_id=eq.${emp.id}&select=producto_id`, 'dominio')).toHaveLength(3)
    } finally {
      if (orgId) {
        await borrar(`usuarios_organizacion?organizacion_id=eq.${orgId}`)
        await borrar(`organizaciones?id=eq.${orgId}`)
      }
      for (const id of usuarios) await borrarUsuario(id)
    }
  })
})

test.describe('Catálogo · productividad (MSF-218, F-CAT-13)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-398:T014] [F-CAT-13#1] duplica y guarda un producto nuevo activo sin SKU copiado', async ({ page }) => {
    const sufijo = randomUUID().slice(0, 8)
    const correo = `operador-duplica-${sufijo}@example.com`
    const nombre = `Original ${sufijo}`
    const skuOrigen = `E2E-D-${sufijo}`
    const usuarios: string[] = []
    let orgId: string | undefined
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E duplica ${sufijo}` })
      orgId = org.id
      const idOperador = await altaUsuario(correo)
      usuarios.push(idOperador)
      await rest('usuarios_organizacion', { user_id: idOperador, organizacion_id: org.id, rol_id: 'operador' })
      await rest('productos', { organizacion_id: org.id, nombre, sku: skuOrigen, precio_lista: 10, activo: false }, 'dominio')

      await ingresar(page, correo)
      await page.goto('/productos')
      await page.getByLabel('Buscar por nombre, SKU o código de barras').fill(sufijo)
      await page.getByRole('button', { name: `Duplicar ${nombre}` }).click()
      await expect(page).toHaveURL(/\/productos\/create\?duplicar_de=/)
      await expect(page.getByLabel(/^Nombre/)).toHaveValue(nombre)
      await expect(page.getByLabel(/^SKU/)).toHaveValue('')

      await page.getByLabel(/^Nombre/).fill(`Copia ${sufijo}`)
      await page.getByRole('button', { name: 'Crear producto' }).click()
      await expect(page.getByText('Producto creado')).toBeVisible()

      const copias = await leer<{ activo: boolean; sku: string | null }>(`productos?organizacion_id=eq.${org.id}&nombre=eq.Copia ${sufijo}&select=activo,sku`, 'dominio')
      expect(copias).toHaveLength(1)
      expect(copias[0].activo).toBe(true)
      expect(copias[0].sku).not.toBe(skuOrigen)
    } finally {
      if (orgId) {
        await borrar(`usuarios_organizacion?organizacion_id=eq.${orgId}`)
        await borrar(`organizaciones?id=eq.${orgId}`)
      }
      for (const id of usuarios) await borrarUsuario(id)
    }
  })
})
