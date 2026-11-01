import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

// F-SVC-22 (MSF-157, SC-008): enlace de seguimiento. La persona del taller copia el enlace desde el detalle; el
// cliente lo abre SIN sesión y ve el estado de su reparación y nunca datos de otro cliente ni internos; un token
// inventado dice «No encontramos esa reparación».
// Requiere el stack local (`pnpm dev:supabase`), la función `consultar-estado-reparacion` servida con SEGUIMIENTO_IP_SALT y la web servida; siembra con la API admin desde Node (la
// service-role key nunca llega al navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se omite
// (no entra al CI público): ver docs/e2e-app.md y docs/service-seguimiento.md.
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

async function organizacionConReparacion(sufijo: string, cliente_nombre: string, falla: string, serie: string) {
  const correo = `admin-seguimiento-${sufijo}@example.com`
  const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E seguimiento ${sufijo}` })
  const [empresa] = await rest<{ id: string }>('empresas', { organizacion_id: org.id, nombre: `Tienda seguimiento ${sufijo}` }, 'dominio')
  const userId = await altaUsuario(correo)
  await rest('usuarios_organizacion', { user_id: userId, organizacion_id: org.id, rol_id: 'administrador' })
  await rest('features', { id: 'service-tecnico', nombre: 'Service técnico', descripcion: 'E2E' }, 'public', 'resolution=ignore-duplicates')
  await rest('organizaciones_features', { feature_id: 'service-tecnico', organizacion_id: org.id, habilitado_por: userId })
  const [cliente] = await rest<{ id: string }>('clientes', { organizacion_id: org.id, numero: 1, nombre: cliente_nombre, tipo: 'minorista' })
  const [modelo] = await leer<{ id: string }>(`modelos_equipo?organizacion_id=eq.${org.id}&select=id&limit=1`, 'dominio')
  const token = await tokenDe(correo)
  const { id: reparacionId } = await rpcComo<{ id: string }>(token, 'crear_reparacion', {
    p_empresa_id: empresa.id, p_cliente_id: cliente.id, p_modelo_id: modelo.id, p_falla: falla, p_numero_serie: serie,
  })
  return { correo, orgId: org.id, userId, reparacionId, token, tienda: `Tienda seguimiento ${sufijo}` }
}

test.describe('Service técnico · enlace de seguimiento para el cliente (MSF-157, SC-008)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-157:T040] copiar el enlace, abrirlo sin sesión y no ver datos ajenos ni internos', async ({ browser }) => {
    const sufijo = randomUUID().slice(0, 8)
    const creadas: { orgId: string; userId: string }[] = []
    try {
      const uno = await organizacionConReparacion(sufijo + 'a', 'Cliente Secreto Uno', 'Falla secreta uno', 'SERIE-SECRETA-1')
      creadas.push(uno)
      const dos = await organizacionConReparacion(sufijo + 'b', 'Cliente Secreto Dos', 'Falla secreta dos', 'SERIE-SECRETA-2')
      creadas.push(dos)

      // La persona del taller abre el enlace desde el detalle (FR-046).
      const taller = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
      const panel = await taller.newPage()
      await ingresar(panel, uno.correo)
      await panel.goto(`/service-tecnico/reparaciones/${uno.reparacionId}`)
      await panel.getByRole('button', { name: 'Enlace de seguimiento' }).click()
      const dialogo = panel.getByRole('dialog')
      const campo = dialogo.getByLabel('Enlace para el cliente')
      await expect(campo).toHaveValue(/\/seguimiento\/[A-Za-z0-9_-]{32}$/)
      const enlace = await campo.inputValue()
      await dialogo.getByRole('button', { name: 'Copiar enlace' }).click()
      await expect(dialogo.getByText('Enlace copiado')).toBeVisible()
      await taller.close()

      // El cliente lo abre sin iniciar sesión (FR-041): solo la lista blanca (FR-044).
      const anonimo = await browser.newContext()
      const publica = await anonimo.newPage()
      await publica.goto(enlace)
      await expect(publica.getByRole('heading', { name: 'Reparación R-0001' })).toBeVisible()
      await expect(publica.getByText(uno.tienda)).toBeVisible()
      await expect(publica.getByText('Estado actual')).toBeVisible()
      await expect(publica.getByRole('navigation')).toHaveCount(0)
      const contenido = await publica.locator('body').innerText()
      for (const prohibido of ['Cliente Secreto Uno', 'Falla secreta uno', 'SERIE-SECRETA-1', 'Cliente Secreto Dos', dos.tienda]) {
        expect(contenido).not.toContain(prohibido)
      }
      await expect(publica.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)

      // El token de la otra organización muestra solo lo suyo (FR-044, escenario 7).
      const tokenDos = (await rpcComo<{ token: string }>(dos.token, 'obtener_enlace_consulta', { p_reparacion: dos.reparacionId })).token
      await publica.goto(`/seguimiento/${tokenDos}`)
      await expect(publica.getByText(dos.tienda)).toBeVisible()
      const contenidoDos = await publica.locator('body').innerText()
      for (const prohibido of ['Cliente Secreto', 'Falla secreta', 'SERIE-SECRETA', uno.tienda]) {
        expect(contenidoDos).not.toContain(prohibido)
      }

      // Un token inventado no da pistas (FR-045, escenario 4).
      await publica.goto('/seguimiento/' + 'Z'.repeat(32))
      await expect(publica.getByText('No encontramos esa reparación')).toBeVisible()
      await publica.goto('/seguimiento/corto')
      await expect(publica.getByText('No encontramos esa reparación')).toBeVisible()
      await anonimo.close()
    } finally {
      for (const c of creadas) {
        await borrar(`organizaciones?id=eq.${c.orgId}`)
        await borrarUsuario(c.userId)
      }
    }
  })
})
