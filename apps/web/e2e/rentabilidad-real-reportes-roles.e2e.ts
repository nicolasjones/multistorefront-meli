import { randomUUID } from 'node:crypto'
import { abrirContextoGrabado, cerrarContextoGrabado, expect, test } from './fixture'

// Cierre de MSF-192 (T041, SC-013): los cuatro reportes de la épica («Ventas reales», «Productos más consultados»,
// «Ventas por período y canal» y los ya existentes de «Reportes de ventas») y la sección «Costos adicionales», con
// Administrador, Administración y Operador/Consulta. Requiere el stack local (`pnpm dev:supabase`) y la web servida;
// siembra con la API admin desde Node (la service-role key nunca llega al navegador). Los tableros de Superset no se
// montan acá (necesitan un Superset real): el marco, la pestaña y el acceso salen de la pantalla y de la base.
// Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se omite: ver docs/e2e-app.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de rentabilidad real: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
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

const SIN_ACCESO = 'No tenés acceso a esta sección'
const PESTANAS_REPORTES = ['Más vendidos', 'Ranking de clientes', 'Productos más consultados', 'Ventas por período y canal']

test.describe('Rentabilidad real y reportes de ventas con los tres roles (MSF-192, SC-013)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-741:T041] Administrador y Administración ven los reportes y los costos; Operador y Consulta quedan restringidos', async ({ browser }, testInfo) => {
    test.setTimeout(90_000) // recorre los reportes con cuatro roles, cada uno en su propia sesión
    const sufijo = randomUUID().slice(0, 8)
    const roles = {
      administrador: `admin-rr-${sufijo}@example.com`,
      administracion: `administracion-rr-${sufijo}@example.com`,
      operador: `operador-rr-${sufijo}@example.com`,
      consulta: `consulta-rr-${sufijo}@example.com`,
    } as const

    let orgId: string | undefined
    const ids: string[] = []
    const ingresar = async (page: import('@playwright/test').Page, correo: string) => {
      await page.goto('/login')
      await page.getByLabel('Correo').fill(correo)
      await page.getByLabel('Contraseña').fill(password)
      await page.getByRole('button', { name: 'Ingresar' }).click()
      await expect(page).not.toHaveURL(/\/login/)
    }
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E rentabilidad real ${sufijo}` })
      orgId = org.id
      const asignaciones: Array<{ user_id: string; organizacion_id: string; rol_id: string }> = []
      for (const [rol, correo] of Object.entries(roles)) {
        const id = await altaUsuario(correo)
        ids.push(id)
        asignaciones.push({ user_id: id, organizacion_id: org.id, rol_id: rol })
      }
      await rest('usuarios_organizacion', asignaciones)
      await rest('empresas', { organizacion_id: org.id, nombre: `Empresa rentabilidad real ${sufijo}`, activa: true }, 'dominio')

      // Administrador y Administración leen todo; solo el Administrador edita los costos adicionales.
      for (const rol of ['administrador', 'administracion'] as const) {
        const { contexto, page } = await abrirContextoGrabado(browser, testInfo, rol)
        try {
          await ingresar(page, roles[rol])
          await page.goto('/rentabilidad/ventas-reales')
          await expect(page.getByRole('tab', { name: 'Ventas reales' })).toBeVisible()
          await expect(page.getByRole('heading', { name: SIN_ACCESO })).toHaveCount(0)

          await page.goto('/rentabilidad/costos')
          await expect(page.getByRole('heading', { name: SIN_ACCESO })).toHaveCount(0)
          await expect(page.getByRole('tab', { name: 'Costos adicionales' })).toBeVisible()

          await page.goto('/ventas/reportes')
          await expect(page.getByRole('heading', { name: 'Reportes de ventas' })).toBeVisible()
          for (const pestana of PESTANAS_REPORTES) await expect(page.getByRole('tab', { name: pestana })).toBeVisible()
          await page.getByRole('tab', { name: 'Productos más consultados' }).click()
          await expect(page.getByRole('tab', { name: 'Productos más consultados', selected: true })).toBeVisible()
          await page.getByRole('tab', { name: 'Ventas por período y canal' }).click()
          await expect(page.getByRole('tab', { name: 'Ventas por período y canal', selected: true })).toBeVisible()
        } finally {
          await cerrarContextoGrabado(contexto, page, testInfo)
        }
      }

      // Operador y Consulta: acceso restringido en las cinco superficies.
      for (const rol of ['operador', 'consulta'] as const) {
        const { contexto, page } = await abrirContextoGrabado(browser, testInfo, rol)
        try {
          await ingresar(page, roles[rol])
          for (const ruta of ['/rentabilidad/ventas-reales', '/rentabilidad/costos', '/ventas/reportes']) {
            await page.goto(ruta)
            await expect(page.getByRole('heading', { name: SIN_ACCESO })).toBeVisible()
          }
          await expect(page.getByRole('tab', { name: 'Ventas por período y canal' })).toHaveCount(0)
        } finally {
          await cerrarContextoGrabado(contexto, page, testInfo)
        }
      }
    } finally {
      if (orgId) {
        await borrar(`empresas?organizacion_id=eq.${orgId}`, 'dominio')
        await borrar(`usuarios_organizacion?organizacion_id=eq.${orgId}`)
        await borrar(`organizaciones?id=eq.${orgId}`)
      }
      for (const id of ids) await borrarUsuario(id)
    }
  })
})
