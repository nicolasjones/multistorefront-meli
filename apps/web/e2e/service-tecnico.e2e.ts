import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

// F-SVC-03 (MSF-303, SC-005): una reparación se crea, pasa por tres estados y se entrega/retira desde el detalle.
// Requiere el stack local (`pnpm dev:supabase`) y la web servida; siembra con la API admin desde Node (la
// service-role key nunca llega al navegador). El alta se hace con la RPC `crear_reparacion` con la sesión de la
// persona (el selector de cliente tiene su propia cobertura Vitest). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
// el archivo se omite (no entra al CI público): ver docs/e2e-app.md y docs/service-tecnico.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
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

// Sesión de la persona (no la service-role) para llamar a la RPC como lo haría la app.
async function crearReparacionComo(correo: string, empresaId: string, clienteId: string, modeloId: string): Promise<string> {
  const sesion = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey ?? serviceKey ?? '', 'content-type': 'application/json' },
    body: JSON.stringify({ email: correo, password }),
  })
  if (!sesion.ok) throw new Error(`login de ${correo}: ${sesion.status} ${await sesion.text()}`)
  const { access_token } = (await sesion.json()) as { access_token: string }
  const r = await fetch(`${url}/rest/v1/rpc/crear_reparacion`, {
    method: 'POST',
    headers: { apikey: anonKey ?? serviceKey ?? '', authorization: `Bearer ${access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_empresa_id: empresaId, p_cliente_id: clienteId, p_modelo_id: modeloId, p_falla: 'No enciende' }),
  })
  if (!r.ok) throw new Error(`crear_reparacion: ${r.status} ${await r.text()}`)
  return ((await r.json()) as { id: string }).id
}

async function ingresar(page: Page, correo: string) {
  await page.goto('/login')
  await page.getByLabel('Correo').fill(correo)
  await page.getByLabel('Contraseña').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

async function elegirEstado(page: Page, nombre: string) {
  await page.getByRole('combobox', { name: 'Estado' }).click()
  await page.getByRole('option', { name: nombre, exact: true }).click()
}

test.describe('Service técnico · estado, historial y entrega (F-SVC-03)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('crea una reparación, la pasa por tres estados y la entrega', async ({ browser }) => {
    const sufijo = randomUUID().slice(0, 8)
    const correo = `admin-svc-${sufijo}@example.com`
    let orgId: string | undefined
    let userId: string | undefined
    try {
      // El sembrado de F-SVC-01 crea modelos y estados al dar de alta la organización.
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E service ${sufijo}` })
      orgId = org.id
      const [empresa] = await rest<{ id: string }>('empresas', { organizacion_id: org.id, nombre: `Tienda ${sufijo}` }, 'dominio')
      userId = await altaUsuario(correo)
      await rest('usuarios_organizacion', { user_id: userId, organizacion_id: org.id, rol_id: 'administrador' })
      await rest('features', { id: 'service-tecnico', nombre: 'Service técnico', descripcion: 'E2E' }, 'public', 'resolution=ignore-duplicates')
      await rest('organizaciones_features', { feature_id: 'service-tecnico', organizacion_id: org.id, habilitado_por: userId })
      const [cliente] = await rest<{ id: string }>('clientes', { organizacion_id: org.id, numero: 1, nombre: `Cliente ${sufijo}`, tipo: 'minorista' })
      const [modelo] = await (async () => {
        const r = await fetch(`${url}/rest/v1/modelos_equipo?organizacion_id=eq.${org.id}&select=id&limit=1`, {
          headers: cabeceras({ 'accept-profile': 'dominio' }),
        })
        if (!r.ok) throw new Error(`modelos: ${r.status} ${await r.text()}`)
        return (await r.json()) as Array<{ id: string }>
      })()
      const reparacionId = await crearReparacionComo(correo, empresa.id, cliente.id, modelo.id)

      const contexto = await browser.newContext()
      const page = await contexto.newPage()
      await ingresar(page, correo)
      await page.goto(`/service-tecnico/reparaciones/${reparacionId}`)
      await expect(page.getByRole('heading', { name: /Reparación R-/ })).toBeVisible()

      // Tres estados: cada cambio queda en el historial, el más reciente primero.
      await elegirEstado(page, 'En diagnóstico')
      await expect(page.getByText('Estado cambiado a «En diagnóstico»')).toBeVisible()
      await elegirEstado(page, 'En reparación')
      await expect(page.getByText('Estado cambiado a «En reparación»')).toBeVisible()
      await elegirEstado(page, 'Listo para entregar')
      await expect(page.getByText('Estado cambiado a «Listo para entregar»')).toBeVisible()
      const historial = page.getByRole('list', { name: 'Historial de estados' }).getByRole('listitem')
      await expect(historial.first()).toContainText('En reparación → Listo para entregar')
      await expect(historial).toHaveCount(4)

      // Entrega: el estado que cierra abre el diálogo; sin «Quién entregó» no avanza.
      await elegirEstado(page, 'Entregado')
      const dialogo = page.getByRole('dialog', { name: /Entrega/ })
      await dialogo.getByRole('button', { name: 'Registrar entrega' }).click()
      await expect(dialogo.getByText('Indicá quién retira o recibe el equipo.')).toBeVisible()
      await dialogo.getByLabel(/Quién entregó/).fill('María Pérez')
      await dialogo.getByRole('button', { name: 'Registrar entrega' }).click()
      await expect(dialogo).toBeHidden()
      await expect(page.getByText(/Reparación R-\d+ entregada/)).toBeVisible()
      await expect(page.getByRole('combobox', { name: 'Estado' })).toHaveAttribute('aria-disabled', 'true')
      await expect(historial.first()).toContainText('Entregada')
      await contexto.close()
    } finally {
      if (orgId) await borrar(`organizaciones?id=eq.${orgId}`)
      if (userId) await borrarUsuario(userId)
    }
  })
})
