import { randomUUID } from 'node:crypto'
import { expect, test } from './fixture'

// MSF-693: con más de 500 productos activos, el selector de «Nuevo ingreso» solo traía los
// primeros por nombre y no dejaba elegir el resto (ni avisaba del corte). Este recorrido
// siembra 501 productos: el último por nombre queda fuera del tope y tiene que aparecer
// cuando se escribe, y la pantalla avisa que el catálogo se cortó.
// Requiere el stack local (`pnpm dev:supabase`) y la web servida; siembra con la API admin
// desde Node (la service-role key nunca llega al navegador). Sin SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY el archivo se omite.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de catálogo: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
}

const TOTAL_PRODUCTOS = 501

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

test.describe('Catálogo de productos del ingreso de mercadería (MSF-693)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-693:BUG] con más de 500 productos se avisa del corte y se puede elegir el que queda fuera del tope', async ({ page }) => {
    const sufijo = randomUUID().slice(0, 8)
    const correo = `admin-catalogo-${sufijo}@example.com`
    const empresa = `Tienda E2E ${sufijo}`
    const proveedor = `Proveedor E2E ${sufijo}`
    // El último por nombre es el que queda fuera de los primeros 500.
    const productoFuera = `Producto E2E ${String(TOTAL_PRODUCTOS - 1).padStart(3, '0')} ${sufijo}`

    let orgId: string | undefined
    let idUsuario: string | undefined
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E catálogo ${sufijo}` })
      orgId = org.id
      idUsuario = await altaUsuario(correo)
      await rest('usuarios_organizacion', [{ user_id: idUsuario, organizacion_id: org.id, rol_id: 'administrador' }])
      await rest('empresas', { organizacion_id: org.id, nombre: empresa, activa: true }, 'dominio')
      await rest('proveedores', {
        organizacion_id: org.id, razon_social: proveedor, cuit: '20123456786', activo: true,
      }, 'dominio')
      await rest('productos', Array.from({ length: TOTAL_PRODUCTOS }, (_, i) => ({
        organizacion_id: org.id,
        nombre: `Producto E2E ${String(i).padStart(3, '0')} ${sufijo}`,
        sku: `E2E-${String(i).padStart(3, '0')}-${sufijo}`,
        precio_lista: 10,
      })), 'dominio')

      await page.goto('/login')
      await page.getByLabel('Correo').fill(correo)
      await page.getByLabel('Contraseña').fill(password)
      await page.getByRole('button', { name: 'Ingresar' }).click()
      await expect(page).not.toHaveURL(/\/login/)

      await page.goto('/stock/ingresos')
      const campo = page.getByLabel('Producto 1')
      await campo.click()

      // La pantalla avisa que el catálogo se cortó.
      await expect(page.getByText(/Hay más de 500 productos/)).toBeVisible()

      // Lo que queda fuera del tope se encuentra escribiendo: la búsqueda es del servidor.
      await campo.fill('E2E 500')
      const opcion = page.getByRole('option', { name: productoFuera })
      await expect(opcion).toBeVisible()
      await opcion.click()
      await expect(campo).toHaveValue(new RegExp(productoFuera))
    } finally {
      // La baja de la organización arrastra productos, empresa y proveedor (ON DELETE CASCADE).
      if (orgId) {
        await borrar(`usuarios_organizacion?organizacion_id=eq.${orgId}`)
        await borrar(`organizaciones?id=eq.${orgId}`)
      }
      if (idUsuario) await borrarUsuario(idUsuario)
    }
  })
})
