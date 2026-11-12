import { randomUUID } from 'node:crypto'
import { expect, test } from './fixture'

// F-PRE-10 (MSF-436, SC-003): actualización masiva de costos y precios. El administrador entra desde
// Productos, elige +10 % sobre el precio de lista, ve la vista previa antes → después (sin que se
// escriba nada), confirma y los precios quedan cambiados. Requiere el stack local (`pnpm dev:supabase`)
// y la web servida; siembra con la API admin desde Node (la service-role key nunca llega al
// navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se omite: ver docs/e2e-app.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de precios masivos: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
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

// MSF-363 (decisión 15): la bandera `precios_masivos` nace APAGADA; el E2E la enciende y devuelve el valor previo al terminar.
async function fijarBandera(clave: string, activa: boolean): Promise<boolean> {
  const ruta = `banderas_plataforma?clave=eq.${clave}`
  const previa = (await leer<{ activa: boolean }>(`${ruta}&select=activa`))[0]?.activa ?? false
  const r = await fetch(`${url}/rest/v1/${ruta}`, {
    method: 'PATCH',
    headers: cabeceras({ 'content-profile': 'public' }),
    body: JSON.stringify({ activa }),
  })
  if (!r.ok) throw new Error(`bandera ${clave}: ${r.status} ${await r.text()}`)
  return previa
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

test.describe('Actualización masiva de costos y precios (MSF-436)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-436:T009] vista previa antes → después sin escribir y, al confirmar, los precios quedan cambiados', async ({ page }) => {
    const sufijo = randomUUID().slice(0, 8)
    const correo = `admin-masivos-${sufijo}@example.com`
    const nombre = `Joystick masivo ${sufijo}`
    let orgId: string | undefined
    let idUsuario: string | undefined
    let banderaPrevia = false
    try {
      banderaPrevia = await fijarBandera('precios_masivos', true)
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E masivos ${sufijo}` })
      orgId = org.id
      idUsuario = await altaUsuario(correo)
      await rest('usuarios_organizacion', [{ user_id: idUsuario, organizacion_id: org.id, rol_id: 'administrador' }])
      await rest('empresas', { organizacion_id: org.id, nombre: `Tienda masivos ${sufijo}`, activa: true }, 'dominio')
      const [producto] = await rest<{ id: string }>('productos', {
        organizacion_id: org.id, nombre, sku: `MAS-${sufijo}`, moneda: 'ARS', precio_lista: 100,
      }, 'dominio')
      await rest('producto_costos', { producto_id: producto.id, organizacion_id: org.id, costo: 60 }, 'dominio')

      await page.goto('/login')
      await page.getByLabel('Correo').fill(correo)
      await page.getByLabel('Contraseña').fill(password)
      await page.getByRole('button', { name: 'Ingresar' }).click()
      await expect(page).not.toHaveURL(/\/login/)

      // Entrada desde Productos.
      await page.goto('/productos')
      await page.getByRole('link', { name: 'Actualizar precios' }).click()
      await expect(page).toHaveURL(/\/productos\/precios-masivos$/)
      await expect(page.getByRole('heading', { name: 'Actualizar precios' })).toBeVisible()

      // Sin viewports rotos: la pantalla no desborda a 320, 768 ni 1440 px.
      for (const ancho of [320, 768, 1440]) {
        await page.setViewportSize({ width: ancho, height: 900 })
        const desborda = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
        expect(desborda, `desborde horizontal a ${ancho}px`).toBe(false)
      }
      await page.setViewportSize({ width: 1920, height: 1080 })

      // Vista previa: costo y lista +10 %, sin escribir.
      await page.getByLabel('Qué cambia').click()
      await page.getByRole('option', { name: 'Costo y precio de lista' }).click()
      await page.getByLabel('Porcentaje').fill('10')
      await page.getByRole('button', { name: 'Ver vista previa' }).click()
      const tabla = page.getByRole('table', { name: 'Vista previa de la actualización de precios' })
      await expect(tabla.getByText(nombre)).toBeVisible()
      await expect(tabla.getByText('100,00 → 110,00 ARS')).toBeVisible()
      await expect(tabla.getByText('60,00 → 66,00 ARS')).toBeVisible()
      const [antes] = await leer<{ precio_lista: number }>(`productos?id=eq.${producto.id}&select=precio_lista`, 'dominio')
      expect(Number(antes.precio_lista)).toBe(100)

      // Confirmación.
      await page.getByRole('button', { name: 'Confirmar actualización' }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Aplicar' }).click()
      await expect(page.getByText('Listo: se actualizó 1 producto.')).toBeVisible()
      const [despues] = await leer<{ precio_lista: number }>(`productos?id=eq.${producto.id}&select=precio_lista`, 'dominio')
      expect(Number(despues.precio_lista)).toBe(110)
      const [costo] = await leer<{ costo: number }>(`producto_costos?producto_id=eq.${producto.id}&select=costo`, 'dominio')
      expect(Number(costo.costo)).toBe(66)
    } finally {
      await fijarBandera('precios_masivos', banderaPrevia).catch((e: unknown) => console.warn('limpieza E2E: bandera', e))
      if (orgId) await borrar(`organizaciones?id=eq.${orgId}`)
      if (idUsuario) await borrarUsuario(idUsuario)
    }
  })
})
