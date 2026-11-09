import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

// Cierre de MSF-352 (T040, SC-012): (1) cambiar el alcance de la cotización con su vista previa y confirmar;
// (2) fijar un precio propio desde la ficha del producto, verlo marcado en «Así quedan los precios» y comprobar que
// NO se mueve al cambiar el ajuste, mientras el otro producto sí. Requiere el stack local (`pnpm dev:supabase`) y la
// web servida; siembra con la API admin desde Node (la service-role key nunca llega al navegador). Sin
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se omite (no entra al CI público): ver docs/e2e-app.md.
//
// Cifras (dólar 1.465, productos en ARS para no depender de la cotización en el simulador):
//   «Joystick» y «Cable» con lista $ 10.000 · regla «Central con ajuste» +15 % ⇒ Cable $ 11.500
//   Joystick con precio propio $ 25.000 ⇒ sigue en $ 25.000 con cualquier ajuste
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

// La service-role key crea y borra datos: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de dólar y precio propio: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
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

async function borrar(ruta: string, esquema = 'public') {
  const r = await fetch(`${url}/rest/v1/${ruta}`, { method: 'DELETE', headers: cabeceras({ 'content-profile': esquema }) })
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

test.describe('Configuración del dólar y precio propio (MSF-352, SC-012)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('cambiar el alcance con vista previa y confirmar; precio propio marcado y fijo en el simulador', async ({ browser }) => {
    const sufijo = randomUUID().slice(0, 8)
    const correo = `admin-dolar-${sufijo}@example.com`
    const empresa = `Tienda ${sufijo}`
    const joystick = `Joystick ${sufijo}`
    const cable = `Cable ${sufijo}`

    let orgId: string | undefined
    let idUsuario: string | undefined
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E dólar ${sufijo}` })
      orgId = org.id
      idUsuario = await altaUsuario(correo)
      await rest('usuarios_organizacion', [{ user_id: idUsuario, organizacion_id: org.id, rol_id: 'administrador' }])
      const [tienda] = await rest<{ id: string }>('empresas', [{ organizacion_id: org.id, nombre: empresa }], 'dominio')
      await rest('cotizacion_inicial', { organizacion_id: org.id, valor: 1465 }, 'dominio')
      const productos = await rest<{ id: string }>(
        'productos',
        [
          { organizacion_id: org.id, nombre: joystick, sku: `E2E-J-${sufijo}`, moneda: 'ARS', precio_lista: 10000 },
          { organizacion_id: org.id, nombre: cable, sku: `E2E-C-${sufijo}`, moneda: 'ARS', precio_lista: 10000 },
        ],
        'dominio',
      )
      // El joystick se vende en la empresa: así aparece la fila de «Precio propio por empresa» en su ficha.
      await rest('producto_empresa', [{ producto_id: productos[0].id, empresa_id: tienda.id, organizacion_id: org.id }], 'dominio')

      const contexto = await browser.newContext()
      const page = await contexto.newPage()
      await ingresar(page, correo)

      // 1. Alcance: de «Una para todo el sistema» a «Una por empresa», con la vista previa y la confirmación.
      await page.goto('/cotizacion')
      await expect(page.getByRole('button', { name: 'Una para todo el sistema', pressed: true })).toBeVisible()
      await page.getByRole('button', { name: 'Una por empresa' }).click()
      const dialogo = page.getByRole('dialog')
      await expect(dialogo).toBeVisible()
      await expect(dialogo.getByText('precios que cambian')).toBeVisible()
      // Cancelar no cambia nada.
      await dialogo.getByRole('button', { name: 'Cancelar' }).click()
      await expect(page.getByRole('button', { name: 'Una para todo el sistema', pressed: true })).toBeVisible()
      // Confirmar sí.
      await page.getByRole('button', { name: 'Una por empresa' }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Cambiar alcance' }).click()
      await expect(page.getByRole('button', { name: 'Una por empresa', pressed: true })).toBeVisible()

      // 2. Precio propio desde la ficha del joystick.
      await page.goto(`/productos/${productos[0].id}/edit`)
      const campo = page.getByLabel(`Precio propio (${empresa})`)
      await expect(campo).toBeVisible()
      await campo.fill('25000')
      await page.getByRole('button', { name: `Guardar precio propio de ${empresa}` }).click()
      await expect(page.getByRole('button', { name: `Quitar precio propio de ${empresa}` })).toBeEnabled()

      // 3. Simulador: el joystick queda marcado y el cable sigue la regla.
      await page.goto(`/empresas/edit/${tienda.id}/precios`)
      const tabla = page.getByRole('table', { name: 'Así quedan los precios' })
      const filaJoystick = tabla.getByRole('row', { name: new RegExp(joystick) })
      const filaCable = tabla.getByRole('row', { name: new RegExp(cable) })
      await expect(filaJoystick).toContainText('Precio propio')
      await expect(filaJoystick).toContainText('$ 25.000')
      await expect(filaCable).toContainText('Central')

      // 4. Mover el ajuste a +15 %: el cable se mueve y queda «Ajustado»; el joystick NO cambia. Nada se guarda.
      await page.getByRole('button', { name: 'Central con ajuste' }).click()
      await page.getByLabel('Ajuste sobre el precio central').fill('15')
      await expect(filaCable).toContainText('$ 11.500')
      await expect(filaCable).toContainText('Ajustado')
      await expect(filaJoystick).toContainText('$ 25.000')
      await expect(filaJoystick).toContainText('Precio propio')

      // 5. Salir sin guardar descarta la simulación: al volver a abrir, la regla guardada sigue sin ajuste.
      await page.goto(`/empresas/edit/${tienda.id}/precios`)
      await expect(page.getByLabel('Ajuste sobre el precio central')).toHaveCount(0)
      await expect(page.getByRole('table', { name: 'Así quedan los precios' }).getByRole('row', { name: new RegExp(cable) })).toContainText('$ 10.000')
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
