import { randomUUID } from 'node:crypto'
import { expect, test, type Locator, type Page } from '@playwright/test'

// F-STK-01 (MSF-268, SC-004): dos sesiones de la misma organización. La A abre `/stock`; la B
// registra una salida que deja el producto con stock bajo → la A ve cantidad, estado y resumen de
// alertas actualizados sin recargar (Supabase Realtime sobre `dominio.existencias`). Requiere el
// stack local (`pnpm dev:supabase`) y la web servida; siembra con la API admin desde Node (la
// service-role key nunca llega al navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el
// archivo se omite (no entra al CI público): ver docs/e2e-app.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

// La service-role key crea y borra datos: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de stock en vivo: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
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

// Fixture de cantidad y mínimo: la app solo escribe por RPC, la siembra lo hace con service-role.
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

// La columna «Stock» es la segunda celda de la fila (tras Producto): el nombre lleva un sufijo hex.
const celdaStock = (fila: Locator) => fila.getByRole('cell').nth(1)

test.describe('Stock actual en vivo (F-STK-01, SC-004)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('la sesión A ve sin recargar la salida que registra la sesión B', async ({ browser }) => {
    const sufijo = randomUUID().slice(0, 8)
    const correoA = `vivo-a-${sufijo}@example.com`
    const correoB = `vivo-b-${sufijo}@example.com`
    const nombre = `Producto vivo ${sufijo}`

    let orgId: string | undefined
    const usuarios: string[] = []
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E vivo ${sufijo}` })
      orgId = org.id
      for (const correo of [correoA, correoB]) {
        const id = await altaUsuario(correo)
        usuarios.push(id)
        await rest('usuarios_organizacion', [{ user_id: id, organizacion_id: org.id, rol_id: 'administrador' }])
      }
      // La existencia nace en 0 por el disparador de productos: 5 con mínimo 3 → «Disponible».
      const [producto] = await rest<{ id: string }>(
        'productos',
        { organizacion_id: org.id, nombre, sku: `VIVO-${sufijo}`, precio_lista: 10 },
        'dominio',
      )
      await actualizar(`existencias?producto_id=eq.${producto.id}`, { cantidad: 5, minimo: 3 }, 'dominio')

      const contextoA = await browser.newContext()
      const contextoB = await browser.newContext()
      const paginaA = await contextoA.newPage()
      const paginaB = await contextoB.newPage()
      await ingresar(paginaA, correoA)
      await ingresar(paginaB, correoB)

      await paginaA.goto('/stock')
      const filaA = paginaA.getByRole('row', { name: new RegExp(nombre) })
      await expect(celdaStock(filaA)).toHaveText('5')
      await expect(paginaA.getByText(/con stock bajo\./)).toHaveCount(0)

      // B registra una salida de 3: queda en 2 (≤ mínimo 3) → «Stock bajo».
      await paginaB.goto('/stock')
      await paginaB.getByRole('button', { name: `Nuevo movimiento de ${nombre}` }).click()
      const dialogo = paginaB.getByRole('dialog', { name: 'Registrar movimiento de stock' })
      await dialogo.getByRole('button', { name: 'Salida', exact: true }).click()
      await dialogo.getByLabel('Cantidad').fill('3')
      await dialogo.getByLabel('Motivo').click()
      await paginaB.getByRole('option').first().click()
      await dialogo.getByRole('button', { name: 'Registrar', exact: true }).click()
      await expect(dialogo.getByText('Movimiento registrado')).toBeVisible()

      // A, sin recargar ni navegar: cantidad, estado y resumen cambian solos.
      await expect(celdaStock(filaA)).toHaveText('2', { timeout: 15_000 })
      await expect(filaA.locator('.MuiChip-label', { hasText: 'Stock bajo' })).toBeVisible()
      await expect(paginaA.getByText('0 productos sin stock y 1 con stock bajo.')).toBeVisible()

      await contextoA.close()
      await contextoB.close()
    } finally {
      // Limpieza: el Supabase local no acumula organizaciones ni usuarios sembrados.
      if (orgId) {
        await borrar(`usuarios_organizacion?organizacion_id=eq.${orgId}`)
        await borrar(`organizaciones?id=eq.${orgId}`)
      }
      for (const id of usuarios) await borrarUsuario(id)
    }
  })
})
