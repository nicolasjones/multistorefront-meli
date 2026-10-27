import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

// Cierre de MSF-127 (T023, SC-007): se suman los tableros «Comparativo» (/rentabilidad/comparativo) e «Historia»
// (/rentabilidad/historia) a la misma corrida de roles: quien lee ve la pestaña, Operador/Consulta quedan restringidos.
const TABLEROS_NUEVOS = [
  { pestana: 'Comparativo', ruta: '/rentabilidad/comparativo' },
  { pestana: 'Historia', ruta: '/rentabilidad/historia' },
] as const

// Cierre de MSF-120 (T032, SC-008): Rentabilidad con los tres roles. El Administrador edita el umbral de
// margen bajo y el cambio se refleja en el aviso; Administración solo lee (sin el botón del umbral); Operador
// y Consulta ven el acceso restringido. Requiere el stack local (`pnpm dev:supabase`) y la web servida; siembra
// con la API admin desde Node (la service-role key nunca llega al navegador). El tablero de Superset no se
// monta acá (necesita un Superset real): el aviso, el diálogo y el acceso salen de la base y de la pantalla.
// Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se omite (no entra al CI público): ver docs/e2e-app.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

const cabeceras = (extra: Record<string, string> = {}) => ({
  apikey: serviceKey ?? '',
  authorization: `Bearer ${serviceKey}`,
  'content-type': 'application/json',
  ...extra,
})

async function rest<T>(ruta: string, cuerpo: unknown, esquema = 'public', prefer = 'return=representation'): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${ruta}`, {
    method: 'POST',
    headers: cabeceras({ prefer, 'content-profile': esquema }),
    body: JSON.stringify(cuerpo),
  })
  if (!r.ok) throw new Error(`REST ${ruta}: ${r.status} ${await r.text()}`)
  return prefer.includes('return=representation') ? ((await r.json()) as T[]) : []
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

test.describe('Rentabilidad con los tres roles (MSF-120, SC-008)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-569:T023] el Administrador edita el umbral, Administración solo lee y Operador/Consulta quedan restringidos', async ({ browser }) => {
    const sufijo = randomUUID().slice(0, 8)
    const roles = {
      administrador: `admin-rent-${sufijo}@example.com`,
      administracion: `administracion-rent-${sufijo}@example.com`,
      operador: `operador-rent-${sufijo}@example.com`,
      consulta: `consulta-rent-${sufijo}@example.com`,
    } as const
    const aviso = 'Hay productos que se venden por debajo del costo o casi. Revisalos en Por producto.'

    let orgId: string | undefined
    const ids: string[] = []
    // Una sesión por rol; cada una se cierra al terminar su bloque.
    const abrir = async (correo: string) => {
      const contexto = await browser.newContext()
      const page = await contexto.newPage()
      await ingresar(page, correo)
      return { contexto, page }
    }
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E rentabilidad ${sufijo}` })
      orgId = org.id
      const asignaciones: Array<{ user_id: string; organizacion_id: string; rol_id: string }> = []
      for (const [rol, correo] of Object.entries(roles)) {
        const id = await altaUsuario(correo)
        ids.push(id)
        asignaciones.push({ user_id: id, organizacion_id: org.id, rol_id: rol })
      }
      await rest('usuarios_organizacion', asignaciones)
      await rest('empresas', { organizacion_id: org.id, nombre: `Empresa rentabilidad ${sufijo}`, activa: true }, 'dominio')
      // Precio de lista 10.000 y costo 9.500: margen 5 %, «bajo» con el umbral por defecto (10 %).
      const [producto] = await rest<{ id: string }>(
        'productos',
        { organizacion_id: org.id, nombre: `Producto margen bajo ${sufijo}`, sku: `E2E-R-${sufijo}`, moneda: 'ARS', precio_lista: 10000, activo: true },
        'dominio',
      )
      await rest('producto_costos', { producto_id: producto.id, organizacion_id: org.id, costo: 9500 }, 'dominio')

      // Administración: lee (ve el aviso) pero no puede cambiar el umbral.
      const administracion = await abrir(roles.administracion)
      await administracion.page.goto('/rentabilidad')
      await expect(administracion.page.getByText(aviso)).toBeVisible()
      await expect(administracion.page.getByRole('button', { name: 'Umbral de margen bajo' })).toHaveCount(0)
      // [MSF-569:T023] Administración lee ambos tableros nuevos: ve la pestaña y no el acceso restringido.
      for (const { pestana, ruta } of TABLEROS_NUEVOS) {
        await administracion.page.goto(ruta)
        await expect(administracion.page.getByRole('link', { name: pestana })).toBeVisible()
        await expect(administracion.page.getByRole('heading', { name: 'No tenés acceso a esta sección' })).toHaveCount(0)
      }
      await administracion.contexto.close()

      // Operador y Consulta: acceso restringido, sin aviso ni botón.
      for (const correo of [roles.operador, roles.consulta]) {
        const { contexto, page } = await abrir(correo)
        await page.goto('/rentabilidad')
        await expect(page.getByRole('heading', { name: 'No tenés acceso a esta sección' })).toBeVisible()
        await expect(page.getByText(aviso)).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Umbral de margen bajo' })).toHaveCount(0)
        // [MSF-569:T023] Tampoco ven Comparativo ni Historia.
        for (const { ruta } of TABLEROS_NUEVOS) {
          await page.goto(ruta)
          await expect(page.getByRole('heading', { name: 'No tenés acceso a esta sección' })).toBeVisible()
        }
        await contexto.close()
      }

      // Administrador: con el umbral por defecto hay aviso; al bajarlo a 3 % el producto (5 %) deja de ser «bajo».
      const admin = await abrir(roles.administrador)
      await admin.page.goto('/rentabilidad')
      await expect(admin.page.getByText(aviso)).toBeVisible()
      // [MSF-569:T023] El Administrador entra a Comparativo e Historia desde las pestañas.
      for (const { pestana, ruta } of TABLEROS_NUEVOS) {
        await admin.page.getByRole('link', { name: pestana }).click()
        await expect(admin.page).toHaveURL(new RegExp(`${ruta}$`))
        await expect(admin.page.getByRole('heading', { name: 'No tenés acceso a esta sección' })).toHaveCount(0)
      }
      await admin.page.goto('/rentabilidad')
      await admin.page.getByRole('button', { name: 'Umbral de margen bajo' }).click()
      const dialogo = admin.page.getByRole('dialog', { name: 'Umbral de margen bajo' })
      const campo = dialogo.getByLabel('Umbral de margen bajo')
      await expect(campo).toHaveValue('10')
      await campo.fill('3')
      await dialogo.getByRole('button', { name: 'Guardar' }).click()
      await expect(dialogo).toBeHidden()
      await expect(admin.page.getByText('Umbral de margen bajo guardado.')).toBeVisible()
      await expect(admin.page.getByText(aviso)).toHaveCount(0)

      // El valor quedó guardado: al reabrir el diálogo se lee el nuevo umbral.
      await admin.page.getByRole('button', { name: 'Umbral de margen bajo' }).click()
      await expect(admin.page.getByRole('dialog', { name: 'Umbral de margen bajo' }).getByLabel('Umbral de margen bajo')).toHaveValue('3')
      await admin.contexto.close()
    } finally {
      // Limpieza: el Supabase local no acumula organizaciones ni usuarios sembrados.
      if (orgId) {
        await borrar(`producto_costos?organizacion_id=eq.${orgId}`, 'dominio')
        await borrar(`productos?organizacion_id=eq.${orgId}`, 'dominio')
        await borrar(`empresas?organizacion_id=eq.${orgId}`, 'dominio')
        await borrar(`rentabilidad_config?organizacion_id=eq.${orgId}`, 'dominio')
        await borrar(`registro_actividad?organizacion_id=eq.${orgId}`)
        await borrar(`usuarios_organizacion?organizacion_id=eq.${orgId}`)
        await borrar(`organizaciones?id=eq.${orgId}`)
      }
      for (const id of ids) await borrarUsuario(id)
    }
  })
})
