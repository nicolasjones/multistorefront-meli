import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

// F-SVC-21 (MSF-146, SC-005): reingreso por garantía. El detalle de una reparación entregada ofrece el botón
// «Reingresar por garantía»; el diálogo pide la falla y, al guardar, lleva al detalle de la nueva, que muestra
// el vínculo con la original; la original lista sus reingresos.
// Requiere el stack local (`pnpm dev:supabase`) y la web servida; siembra con la API admin desde Node (la
// service-role key nunca llega al navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se omite
// (no entra al CI público): ver docs/e2e-app.md y docs/service-garantia.md.
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

async function leer<T>(ruta: string, esquema = 'public'): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${ruta}`, {
    headers: cabeceras({ 'accept-profile': esquema }),
  })
  if (!r.ok) throw new Error(`GET ${ruta}: ${r.status} ${await r.text()}`)
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

const hoyEnArgentina = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())

async function organizacionConReparacionEntregada(sufijo: string) {
  const correo = `admin-garantia-${sufijo}@example.com`
  const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E garantia ${sufijo}` })
  const [empresa] = await rest<{ id: string }>('empresas', { organizacion_id: org.id, nombre: `Tienda garantia ${sufijo}` }, 'dominio')
  const userId = await altaUsuario(correo)
  await rest('usuarios_organizacion', { user_id: userId, organizacion_id: org.id, rol_id: 'administrador' })
  await rest('features', { id: 'service-tecnico', nombre: 'Service técnico', descripcion: 'E2E' }, 'public', 'resolution=ignore-duplicates')
  await rest('organizaciones_features', { feature_id: 'service-tecnico', organizacion_id: org.id, habilitado_por: userId })
  const [cliente] = await rest<{ id: string }>('clientes', { organizacion_id: org.id, numero: 1, nombre: `Cliente garantia ${sufijo}`, tipo: 'minorista' })
  const [modelo] = await leer<{ id: string }>(`modelos_equipo?organizacion_id=eq.${org.id}&select=id&limit=1`, 'dominio')
  const [cierra] = await leer<{ id: string }>(
    `estados_reparacion?organizacion_id=eq.${org.id}&cierra=eq.true&activo=eq.true&select=id&limit=1`,
    'dominio',
  )
  const token = await tokenDe(correo)
  const { id: reparacionId } = await rpcComo<{ id: string }>(token, 'crear_reparacion', {
    p_empresa_id: empresa.id, p_cliente_id: cliente.id, p_modelo_id: modelo.id, p_falla: 'No enciende',
  })
  // Entregada: sin `entrega_real` no se puede reingresar por garantía (FR-024).
  await rpcComo(token, 'registrar_entrega_reparacion', {
    p_id: reparacionId, p_estado_id: cierra.id, p_entrega_real: hoyEnArgentina(), p_entregado_por: 'Ana',
  })
  return { correo, orgId: org.id, userId, reparacionId, token }
}

test.describe('Service técnico · reingreso por garantía (MSF-146, SC-005)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-146:T022] reingresar por garantía desde el detalle y ver los vínculos en ambas reparaciones', async ({ browser }) => {
    const sufijo = randomUUID().slice(0, 8)
    let creada: { orgId?: string; userId?: string } = {}
    try {
      const uno = await organizacionConReparacionEntregada(sufijo)
      creada = uno

      const contexto = await browser.newContext()
      const page = await contexto.newPage()
      await ingresar(page, uno.correo)
      await page.goto(`/service-tecnico/reparaciones/${uno.reparacionId}`)

      // El botón aparece solo con edición y una reparación entregada (FR-022, FR-024).
      const boton = page.getByRole('button', { name: 'Reingresar por garantía' })
      await expect(boton).toBeVisible()

      await boton.click()
      const dialogo = page.getByRole('dialog')
      await expect(dialogo).toBeVisible()
      // El resumen del equipo es de solo lectura y la falla es obligatoria (FR-022).
      await expect(dialogo.locator('dl[aria-label="Resumen del equipo"]')).toContainText('R-0001')

      // Sin falla no se guarda.
      await dialogo.getByRole('button', { name: 'Reingresar' }).click()
      await expect(dialogo.getByText('Describí la falla del reingreso')).toBeVisible()

      await dialogo.getByLabel('Falla del reingreso').fill('Se apaga sola')
      await dialogo.getByRole('button', { name: 'Reingresar' }).click()

      // Al guardar, avisa y lleva al detalle de la nueva (FR-022).
      await expect(page.getByText('Reparación R-0002 creada por garantía')).toBeVisible()
      await expect(dialogo).toBeHidden()
      await expect(page).not.toHaveURL(new RegExp(uno.reparacionId))
      await expect(page.getByRole('heading', { name: 'Reparación R-0002' })).toBeVisible()
      // La nueva muestra el vínculo con la original (FR-023).
      await expect(page.getByRole('link', { name: 'R-0001' })).toBeVisible()

      // La original lista sus reingresos (FR-023).
      await page.goto(`/service-tecnico/reparaciones/${uno.reparacionId}`)
      await expect(page.getByRole('link', { name: 'R-0002' })).toBeVisible()

      await contexto.close()
    } finally {
      if (creada.orgId) await borrar(`organizaciones?id=eq.${creada.orgId}`)
      if (creada.userId) await borrarUsuario(creada.userId)
    }
  })
})
