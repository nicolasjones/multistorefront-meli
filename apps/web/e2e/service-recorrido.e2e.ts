import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

// Cierre de MSF-199 (SC-007): recorrido completo de Service: alta, ítems, cambios de estado, entrega, remito y listado.
// Requiere el stack local (`pnpm dev:supabase`) y la web servida; siembra con la API admin desde Node (la
// service-role key nunca llega al navegador). El alta y la carga de ítems usan las RPC `crear_reparacion` y
// `agregar_item_reparacion` con la sesión de la persona (los diálogos y el selector tienen su cobertura Vitest). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
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

// Llama a una RPC con la sesión de la persona (no la service-role), como lo haría la app.
async function rpcComo<T>(token: string, nombre: string, args: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${url}/rest/v1/rpc/${nombre}`, {
    method: 'POST',
    headers: { apikey: anonKey ?? serviceKey ?? '', authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (!r.ok) throw new Error(`${nombre}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T
}

async function tokenDe(correo: string): Promise<string> {
  const sesion = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey ?? serviceKey ?? '', 'content-type': 'application/json' },
    body: JSON.stringify({ email: correo, password }),
  })
  if (!sesion.ok) throw new Error(`login de ${correo}: ${sesion.status} ${await sesion.text()}`)
  return ((await sesion.json()) as { access_token: string }).access_token
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

test.describe('Service técnico · recorrido completo (MSF-199, SC-007)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('alta, ítems, estados, entrega, remito sin costos y aparición en el listado', async ({ browser }) => {
    const sufijo = randomUUID().slice(0, 8)
    const correo = `admin-rec-${sufijo}@example.com`
    let orgId: string | undefined
    let userId: string | undefined
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E recorrido ${sufijo}` })
      orgId = org.id
      const [empresa] = await rest<{ id: string }>('empresas', { organizacion_id: org.id, nombre: `Tienda ${sufijo}` }, 'dominio')
      userId = await altaUsuario(correo)
      await rest('usuarios_organizacion', { user_id: userId, organizacion_id: org.id, rol_id: 'administrador' })
      await rest('features', { id: 'service-tecnico', nombre: 'Service técnico', descripcion: 'E2E' }, 'public', 'resolution=ignore-duplicates')
      await rest('organizaciones_features', { feature_id: 'service-tecnico', organizacion_id: org.id, habilitado_por: userId })
      const [cliente] = await rest<{ id: string }>('clientes', { organizacion_id: org.id, numero: 1, nombre: `Cliente ${sufijo}`, tipo: 'minorista' })
      const rm = await fetch(`${url}/rest/v1/modelos_equipo?organizacion_id=eq.${org.id}&select=id&limit=1`, {
        headers: cabeceras({ 'accept-profile': 'dominio' }),
      })
      if (!rm.ok) throw new Error(`modelos: ${rm.status} ${await rm.text()}`)
      const [modelo] = (await rm.json()) as Array<{ id: string }>

      // Alta e ítems con la sesión de la persona: 2 × 1.500 de mano de obra + 1 × 2.500 de repuesto = 5.500.
      const token = await tokenDe(correo)
      const { id: reparacionId } = await rpcComo<{ id: string }>(token, 'crear_reparacion', {
        p_empresa_id: empresa.id, p_cliente_id: cliente.id, p_modelo_id: modelo.id, p_falla: 'No enciende',
      })
      await rpcComo(token, 'agregar_item_reparacion', {
        p_reparacion_id: reparacionId, p_tipo: 'mano_obra', p_descripcion: 'Diagnóstico de placa', p_producto_id: null, p_cantidad: 2, p_precio: 1500,
      })
      await rpcComo(token, 'agregar_item_reparacion', {
        p_reparacion_id: reparacionId, p_tipo: 'repuesto', p_descripcion: 'Módulo de pantalla', p_producto_id: null, p_cantidad: 1, p_precio: 2500,
      })

      const contexto = await browser.newContext()
      const page = await contexto.newPage()
      await ingresar(page, correo)
      await page.goto(`/service-tecnico/reparaciones/${reparacionId}`)
      await expect(page.getByRole('heading', { name: /Reparación R-/ })).toBeVisible()
      await expect(page.getByText('Diagnóstico de placa')).toBeVisible()
      await expect(page.getByText('Módulo de pantalla')).toBeVisible()
      await expect(page.getByText(/5\.500/).first()).toBeVisible()

      await elegirEstado(page, 'En diagnóstico')
      await expect(page.getByText('Estado cambiado a «En diagnóstico»')).toBeVisible()
      await elegirEstado(page, 'En reparación')
      await expect(page.getByText('Estado cambiado a «En reparación»')).toBeVisible()
      await elegirEstado(page, 'Listo para entregar')
      await expect(page.getByText('Estado cambiado a «Listo para entregar»')).toBeVisible()

      await elegirEstado(page, 'Entregado')
      const dialogo = page.getByRole('dialog', { name: /Entrega/ })
      await dialogo.getByLabel(/Quién entregó/).fill('María Pérez')
      await dialogo.getByRole('button', { name: 'Registrar entrega' }).click()
      await expect(dialogo).toBeHidden()
      await expect(page.getByText(/Reparación R-\d+ entregada/)).toBeVisible()

      // Remito: ítems y total sin IVA; nunca costos internos ni ganancia.
      await page.goto(`/service-tecnico/reparaciones/${reparacionId}/remito`)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.getByText('Diagnóstico de placa')).toBeVisible()
      await expect(page.getByText('Módulo de pantalla')).toBeVisible()
      await expect(page.getByText(/Total \(sin IVA\):.*5\.500/)).toBeVisible()
      await expect(page.getByText(/ganancia|costo/i)).toHaveCount(0)

      // Listado: la reparación (sin entrega prevista) aparece en el período «mes» por defecto.
      await page.goto('/service-tecnico/reparaciones')
      await expect(page.getByRole('row', { name: new RegExp(`Cliente ${sufijo}`) })).toBeVisible()
      await contexto.close()
    } finally {
      if (orgId) await borrar(`organizaciones?id=eq.${orgId}`)
      if (userId) await borrarUsuario(userId)
    }
  })
})
