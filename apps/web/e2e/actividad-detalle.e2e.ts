import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

// MSF-170 (F-AUD-02, FR-006/FR-007): detalle de un evento de Actividad con el valor anterior y el nuevo. Cubre un
// cambio de rol (Antes/Después) y una baja real (rol y estado antes, nuevo vacío: «—» en cada fila del lado nuevo). Requiere el stack local (`pnpm dev:supabase`) y la web servida; siembra con la API admin
// desde Node. Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY se omite: ver docs/e2e-app.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

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

const haceDias = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString()

test.describe('Detalle de la actividad (F-AUD-02)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('el detalle muestra campo por campo el antes y el después, y «—» del lado nuevo en una baja', async ({ page }) => {
    const sufijo = randomUUID().slice(0, 8)
    const correo = `admin-det-${sufijo}@example.com`
    const marca = `marca${sufijo}`
    let orgId: string | undefined
    let userId: string | undefined
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E detalle ${sufijo}` })
      orgId = org.id
      userId = await altaUsuario(correo)
      await rest('usuarios_organizacion', { user_id: userId, organizacion_id: org.id, rol_id: 'administrador' })
      await rest('registro_actividad', [
        {
          organizacion_id: org.id, actor_id: userId, actor_nombre: 'Ana Admin', tipo: 'usuario.rol_cambiado',
          detalle: `Cambió el rol de ${marca}: Consulta → Mostrador`, creado_en: haceDias(1),
          valor_anterior: { rol: 'Consulta' }, valor_nuevo: { rol: 'Mostrador' },
        },
        {
          organizacion_id: org.id, actor_id: userId, actor_nombre: 'Ana Admin', tipo: 'usuario.removido',
          detalle: `Quitó a ${marca} de la organización`, creado_en: haceDias(2),
          valor_anterior: { rol: 'Consulta', estado: 'Miembro' }, valor_nuevo: {},
        },
      ])

      await ingresar(page, correo)
      await page.goto('/actividad')
      await page.getByLabel('Buscar en la actividad').fill(marca)

      await page.getByRole('button', { name: `Ver detalle: Cambió el rol de ${marca}: Consulta → Mostrador` }).click()
      const dialogo = page.getByRole('dialog', { name: 'Detalle de la actividad' })
      const tabla = dialogo.getByRole('table', { name: 'Valores del cambio' })
      await expect(tabla).toBeVisible()
      await expect(tabla.getByText('Consulta')).toBeVisible()
      await expect(tabla.getByText('Mostrador')).toBeVisible()
      await dialogo.getByRole('button', { name: 'Cerrar' }).first().click()
      await expect(dialogo).toBeHidden()

      await page.getByRole('button', { name: `Ver detalle: Quitó a ${marca} de la organización` }).click()
      const tablaBaja = page.getByRole('dialog', { name: 'Detalle de la actividad' }).getByRole('table', { name: 'Valores del cambio' })
      await expect(tablaBaja.getByText('Miembro')).toBeVisible()
      await expect(tablaBaja.getByText('—')).toHaveCount(2)
    } finally {
      if (orgId) {
        await borrar(`usuarios_organizacion?organizacion_id=eq.${orgId}`)
        await borrar(`organizaciones?id=eq.${orgId}`)
      }
      if (userId) await borrarUsuario(userId)
    }
  })
})
