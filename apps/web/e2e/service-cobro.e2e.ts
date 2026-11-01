import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

// MSF-418 · F-SVC-13 (FR-004, FR-007, FR-009): desde el detalle de una reparación se genera el comprobante de
// Ventas con sus ítems; el detalle muestra la tarjeta «Comprobante asociado» y, en Ventas, el comprobante identifica
// su origen («Reparación R-000N») con enlace al detalle de Service.
// Requiere el stack local (`pnpm dev:supabase`) y la web servida. Siembra con la API admin desde Node (la
// service-role key nunca llega al navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se omite (no
// entra al CI público): ver docs/e2e-app.md y docs/service-cobro.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
const password = 'Correcta-12345!'

// La service-role key escribe datos y crea usuarios con contraseña conocida: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de service cobro: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
}

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

async function leer<T>(ruta: string, esquema = 'dominio'): Promise<T[]> {
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

async function borrar(ruta: string, esquema = 'public') {
  const r = await fetch(`${url}/rest/v1/${ruta}`, { method: 'DELETE', headers: cabeceras({ 'content-profile': esquema }) })
  if (!r.ok) console.warn(`limpieza E2E: DELETE ${ruta} → ${r.status}`)
}

async function borrarUsuario(id: string) {
  const r = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: cabeceras() })
  if (!r.ok) console.warn(`limpieza E2E: baja de usuario ${id} → ${r.status}`)
}

// Sesión de la persona (no la service-role) para llamar a las RPC como lo haría la app.
async function rpcComo(correo: string, nombre: string, cuerpo: Record<string, unknown>): Promise<unknown> {
  const sesion = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey ?? serviceKey ?? '', 'content-type': 'application/json' },
    body: JSON.stringify({ email: correo, password }),
  })
  if (!sesion.ok) throw new Error(`login de ${correo}: ${sesion.status} ${await sesion.text()}`)
  const { access_token } = (await sesion.json()) as { access_token: string }
  const r = await fetch(`${url}/rest/v1/rpc/${nombre}`, {
    method: 'POST',
    headers: { apikey: anonKey ?? serviceKey ?? '', authorization: `Bearer ${access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  })
  if (!r.ok) throw new Error(`rpc ${nombre}: ${r.status} ${await r.text()}`)
  const texto = await r.text()
  return texto ? JSON.parse(texto) : null
}

async function ingresar(page: Page, correo: string) {
  await page.goto('/login')
  await page.getByLabel('Correo').fill(correo)
  await page.getByLabel('Contraseña').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

test.describe('Service técnico · cobro con comprobante de Ventas (F-SVC-13, MSF-418)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-418:T010] genera el comprobante desde la reparación y lo muestra con su origen en Ventas', async ({ browser }) => {
    const sufijo = randomUUID().slice(0, 8)
    const correo = `admin-cobro-${sufijo}@example.com`
    let orgId: string | undefined
    let userId: string | undefined
    try {
      // El sembrado de Service técnico (F-SVC-01) crea modelos y estados al dar de alta la organización.
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E cobro ${sufijo}` })
      orgId = org.id
      const [empresa] = await rest<{ id: string }>('empresas', { organizacion_id: org.id, nombre: `Tienda ${sufijo}` }, 'dominio')
      userId = await altaUsuario(correo)
      await rest('usuarios_organizacion', { user_id: userId, organizacion_id: org.id, rol_id: 'administrador' })
      await rest('features', { id: 'service-tecnico', nombre: 'Service técnico', descripcion: 'E2E' }, 'public', 'resolution=ignore-duplicates')
      await rest('organizaciones_features', { feature_id: 'service-tecnico', organizacion_id: org.id, habilitado_por: userId })
      const [cliente] = await rest<{ id: string }>('clientes', { organizacion_id: org.id, numero: 1, nombre: `Cliente ${sufijo}`, tipo: 'minorista' })
      const modelos = await leer<{ id: string }>('modelos_equipo?organizacion_id=eq.' + org.id + '&select=id&limit=1')
      const modelo = modelos[0]
      if (!modelo) throw new Error('La organización no tiene modelos de equipo sembrados.')

      const creada = (await rpcComo(correo, 'crear_reparacion', {
        p_empresa_id: empresa.id,
        p_cliente_id: cliente.id,
        p_modelo_id: modelo.id,
        p_falla: 'No enciende',
      })) as { id: string }
      const reparacionId = creada.id
      await rpcComo(correo, 'agregar_item_reparacion', {
        p_reparacion_id: reparacionId,
        p_tipo: 'mano_obra',
        p_descripcion: 'Cambio de pantalla',
        p_cantidad: 2,
        p_precio: 1500.5,
      })

      const contexto = await browser.newContext()
      const page = await contexto.newPage()
      await ingresar(page, correo)
      await page.goto(`/service-tecnico/reparaciones/${reparacionId}`)
      await expect(page.getByRole('heading', { name: /Reparación R-/ })).toBeVisible()

      // El botón vive junto al «Total al cliente» (FR-009) y genera el comprobante (FR-001).
      await page.getByRole('button', { name: 'Generar comprobante' }).click()
      const tarjeta = page.getByRole('region', { name: 'Comprobante asociado' })
      await expect(tarjeta).toBeVisible()
      await expect(tarjeta.getByText(/^\d{8}$/)).toBeVisible()
      await expect(tarjeta.getByText('Factura')).toBeVisible()
      await expect(tarjeta.getByText('Borrador')).toBeVisible()
      // Con comprobante vigente el botón ya no se ofrece (FR-004).
      await expect(page.getByRole('button', { name: 'Generar comprobante' })).toHaveCount(0)

      // En Ventas: el comprobante identifica su origen y el enlace lleva al detalle de Service (FR-007).
      await tarjeta.getByRole('link', { name: 'Abrir en Ventas' }).click()
      await expect(page).toHaveURL(/\/ventas\/comprobantes\//)
      const origen = page.getByRole('link', { name: /Reparación R-\d+/ })
      await expect(origen).toBeVisible()
      await origen.click()
      await expect(page).toHaveURL(new RegExp(`/service-tecnico/reparaciones/${reparacionId}`))
      await contexto.close()
    } finally {
      if (orgId) await borrar(`organizaciones?id=eq.${orgId}`)
      if (userId) await borrarUsuario(userId)
    }
  })
})
