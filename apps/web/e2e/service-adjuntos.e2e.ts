import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

// F-SVC-20 (MSF-134, SC-003): fotos y adjuntos del equipo: subir una foto, verla, quitarla; otra organización no lee el objeto.
// Requiere el stack local (`pnpm dev:supabase`) y la web servida; siembra con la API admin desde Node (la
// service-role key nunca llega al navegador). El alta usa la RPC `crear_reparacion` con la sesión de la persona. Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
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

// PNG de 1×1 píxel (cabecera real, para pasar la validación por cabecera de la interfaz).
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

async function organizacionConReparacion(sufijo: string, rotulo: string) {
  const correo = `admin-adj-${rotulo}-${sufijo}@example.com`
  const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E adjuntos ${rotulo} ${sufijo}` })
  const [empresa] = await rest<{ id: string }>('empresas', { organizacion_id: org.id, nombre: `Tienda ${rotulo} ${sufijo}` }, 'dominio')
  const userId = await altaUsuario(correo)
  await rest('usuarios_organizacion', { user_id: userId, organizacion_id: org.id, rol_id: 'administrador' })
  await rest('features', { id: 'service-tecnico', nombre: 'Service técnico', descripcion: 'E2E' }, 'public', 'resolution=ignore-duplicates')
  await rest('organizaciones_features', { feature_id: 'service-tecnico', organizacion_id: org.id, habilitado_por: userId })
  const [cliente] = await rest<{ id: string }>('clientes', { organizacion_id: org.id, numero: 1, nombre: `Cliente ${rotulo} ${sufijo}`, tipo: 'minorista' })
  const rm = await fetch(`${url}/rest/v1/modelos_equipo?organizacion_id=eq.${org.id}&select=id&limit=1`, {
    headers: cabeceras({ 'accept-profile': 'dominio' }),
  })
  if (!rm.ok) throw new Error(`modelos: ${rm.status} ${await rm.text()}`)
  const [modelo] = (await rm.json()) as Array<{ id: string }>
  const token = await tokenDe(correo)
  const { id: reparacionId } = await rpcComo<{ id: string }>(token, 'crear_reparacion', {
    p_empresa_id: empresa.id, p_cliente_id: cliente.id, p_modelo_id: modelo.id, p_falla: 'No enciende',
  })
  return { correo, orgId: org.id, userId, reparacionId, token }
}

test.describe('Service técnico · fotos y adjuntos (MSF-134, SC-003)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-134:T012] subir una foto, verla, quitarla; otra organización no lee el objeto', async ({ browser }) => {
    const sufijo = randomUUID().slice(0, 8)
    const creadas: Array<{ orgId?: string; userId?: string }> = []
    try {
      const uno = await organizacionConReparacion(sufijo, 'uno')
      creadas.push(uno)
      const dos = await organizacionConReparacion(sufijo, 'dos')
      creadas.push(dos)

      const contexto = await browser.newContext()
      const page = await contexto.newPage()
      await ingresar(page, uno.correo)
      await page.goto(`/service-tecnico/reparaciones/${uno.reparacionId}`)
      await expect(page.getByRole('heading', { name: 'Fotos y adjuntos' })).toBeVisible()
      await expect(page.getByText(/todavía no tiene fotos/)).toBeVisible()

      // Subir: el selector es un <input type="file"> oculto detrás de «Agregar fotos».
      await page.getByTestId('entrada-adjuntos').setInputFiles({ name: 'frente.png', mimeType: 'image/png', buffer: PNG_1X1 })
      const miniatura = page.getByRole('img', { name: 'frente.png' })
      await expect(miniatura).toBeVisible()

      // Otra organización no lee el objeto, ni conociendo la ruta (FR-002).
      const lista = await rpcComo<Array<{ ruta: string }>>(uno.token, 'listar_adjuntos_reparacion', { p_reparacion: uno.reparacionId })
      expect(lista).toHaveLength(1)
      const ajeno = await fetch(`${url}/storage/v1/object/authenticated/reparacion-adjuntos/${lista[0].ruta}`, {
        headers: { apikey: anonKey ?? serviceKey ?? '', authorization: `Bearer ${dos.token}` },
      })
      expect(ajeno.ok).toBe(false)
      const propio = await fetch(`${url}/storage/v1/object/authenticated/reparacion-adjuntos/${lista[0].ruta}`, {
        headers: { apikey: anonKey ?? serviceKey ?? '', authorization: `Bearer ${uno.token}` },
      })
      expect(propio.ok).toBe(true)

      // Ver ampliada y quitar con confirmación.
      await page.getByRole('button', { name: 'Ver frente.png' }).click()
      const dialogo = page.getByRole('dialog')
      await expect(dialogo.getByText(/Subida por/)).toBeVisible()
      await dialogo.getByRole('button', { name: 'Quitar' }).click()
      await dialogo.getByRole('button', { name: 'Quitar foto' }).click()
      await expect(dialogo).toBeHidden()
      await expect(page.getByText(/todavía no tiene fotos/)).toBeVisible()
      await expect(await rpcComo<unknown[]>(uno.token, 'listar_adjuntos_reparacion', { p_reparacion: uno.reparacionId })).toHaveLength(0)
      await contexto.close()
    } finally {
      for (const c of creadas) {
        if (c.orgId) await borrar(`organizaciones?id=eq.${c.orgId}`)
        if (c.userId) await borrarUsuario(c.userId)
      }
    }
  })
})
