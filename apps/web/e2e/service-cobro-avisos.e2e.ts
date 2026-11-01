import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

// MSF-576 · T032 (SC-009, cierre de MSF-232): recorrido completo de Service cobro y avisos. Reparación de dos ítems →
// comprobante de Ventas (F-SVC-13) → confirmado y cobrado → aviso al cliente por correo (F-SVC-14) → la reparación
// aparece en la pestaña «Reparaciones» de la ficha del cliente (F-SVC-15).
// Requiere el stack local (`pnpm dev:supabase`) y la web servida. Siembra con la API admin desde Node (la service-role
// key nunca llega al navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se omite. Con
// `E2E_CORREO_KESTRA=1` (Kestra + SMTP de prueba/Mailpit levantados) además espera el correo recibido; sin eso verifica
// el aviso `pendiente`/`enviado` en la base y la orden en la outbox. Ver docs/service-cobro.md y docs/service-avisos.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
const password = 'Correcta-12345!'
const conCorreoKestra = process.env.E2E_CORREO_KESTRA === '1'
const mailpit = process.env.MAILPIT_URL ?? `http://127.0.0.1:${process.env.SUPABASE_MAILPIT_PORT ?? '4302'}`

// La service-role key escribe datos y crea usuarios con contraseña conocida: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de service cobro y avisos: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
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

async function actualizar(ruta: string, cuerpo: unknown, esquema = 'dominio') {
  const r = await fetch(`${url}/rest/v1/${ruta}`, {
    method: 'PATCH',
    headers: cabeceras({ 'content-profile': esquema }),
    body: JSON.stringify(cuerpo),
  })
  if (!r.ok) throw new Error(`REST PATCH ${ruta}: ${r.status} ${await r.text()}`)
}

test.describe('Service técnico · cobro y avisos, recorrido completo (MSF-232)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-576:T032] reparación de dos ítems: comprobante, cobro en Ventas, aviso por correo y pestaña del cliente', async ({ browser }) => {
    const sufijo = randomUUID().slice(0, 8)
    const correo = `admin-recorrido-${sufijo}@example.com`
    const correoCliente = `cliente-${sufijo}@example.com`
    let orgId: string | undefined
    let userId: string | undefined
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E cobro y avisos ${sufijo}` })
      orgId = org.id
      const [empresa] = await rest<{ id: string }>('empresas', { organizacion_id: org.id, nombre: `Tienda ${sufijo}` }, 'dominio')
      userId = await altaUsuario(correo)
      await rest('usuarios_organizacion', { user_id: userId, organizacion_id: org.id, rol_id: 'administrador' })
      await rest('features', { id: 'service-tecnico', nombre: 'Service técnico', descripcion: 'E2E' }, 'public', 'resolution=ignore-duplicates')
      await rest('organizaciones_features', { feature_id: 'service-tecnico', organizacion_id: org.id, habilitado_por: userId })
      const [cliente] = await rest<{ id: string }>('clientes', {
        organizacion_id: org.id,
        numero: 1,
        nombre: `Cliente ${sufijo}`,
        tipo: 'minorista',
        correo: correoCliente,
      })
      const modelos = await leer<{ id: string }>('modelos_equipo?organizacion_id=eq.' + org.id + '&select=id&limit=1')
      if (!modelos[0]) throw new Error('La organización no tiene modelos de equipo sembrados.')

      const { id: reparacionId } = (await rpcComo(correo, 'crear_reparacion', {
        p_empresa_id: empresa.id,
        p_cliente_id: cliente.id,
        p_modelo_id: modelos[0].id,
        p_falla: 'No enciende',
      })) as { id: string }
      for (const [descripcion, tipo, precio] of [
        ['Cambio de pantalla', 'mano_obra', 1500.5],
        ['Pantalla de repuesto', 'repuesto', 8200],
      ] as const) {
        await rpcComo(correo, 'agregar_item_reparacion', { p_reparacion_id: reparacionId, p_tipo: tipo, p_descripcion: descripcion, p_cantidad: 1, p_precio: precio })
      }

      const contexto = await browser.newContext()
      const page = await contexto.newPage()
      await ingresar(page, correo)
      await page.goto(`/service-tecnico/reparaciones/${reparacionId}`)
      await expect(page.getByRole('heading', { name: /Reparación R-/ })).toBeVisible()

      // F-SVC-13: comprobante con los dos ítems como líneas que no tocan stock.
      await page.getByRole('button', { name: 'Generar comprobante' }).click()
      const tarjeta = page.getByRole('region', { name: 'Comprobante asociado' })
      await expect(tarjeta.getByText('Borrador')).toBeVisible()
      const [comprobante] = await leer<{ id: string }>(`comprobantes_venta?origen_tipo=eq.reparacion&origen_id=eq.${reparacionId}&select=id`)
      const lineas = await leer<{ sin_stock: boolean }>(`comprobantes_venta_lineas?comprobante_id=eq.${comprobante.id}&select=sin_stock`)
      expect(lineas).toHaveLength(2)
      expect(lineas.every((l) => l.sin_stock)).toBe(true)

      // Cobro: se confirma por la RPC de Ventas; el disparo del estado «Cobrado» aún no tiene pantalla (F-VTA-10, FR-026),
      // por eso se marca con la service-role desde Node, como lo haría el módulo de cobros.
      await rpcComo(correo, 'confirmar_comprobante', { p_id: comprobante.id })
      await actualizar(`comprobantes_venta?id=eq.${comprobante.id}`, { estado: 'cobrado' })
      await page.reload()
      await expect(page.getByRole('region', { name: 'Comprobante asociado' }).getByText('Cobrado')).toBeVisible()

      // F-SVC-14: aviso al cliente y su historial.
      await page.getByRole('button', { name: 'Avisar al cliente' }).first().click()
      await expect(page.getByText('Aviso enviado al cliente')).toBeVisible()
      const avisos = page.getByRole('region', { name: 'Avisos al cliente' })
      await expect(avisos.getByText(correoCliente)).toBeVisible()
      await expect
        .poll(async () => (await leer<{ estado: string }>(`reparacion_avisos?reparacion_id=eq.${reparacionId}&select=estado`))[0]?.estado, { timeout: 15_000 })
        .toMatch(/^(pendiente|enviado)$/)
      const ordenes = await leer<{ clave: string }>(`capacidades_ejecucion?organizacion_id=eq.${org.id}&clave=like.enviar-aviso-reparacion-*&select=clave`, 'public')
      expect(ordenes.length).toBeGreaterThan(0)

      if (conCorreoKestra) {
        await expect(avisos.getByText('Enviado')).toBeVisible({ timeout: 120_000 })
        const lista = (await (await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${correoCliente}`)}`)).json()) as { messages: Array<{ ID: string }> }
        expect(lista.messages.length).toBeGreaterThan(0)
        const detalle = (await (await fetch(`${mailpit}/api/v1/message/${lista.messages[0].ID}`)).json()) as { Text: string }
        expect(detalle.Text).not.toMatch(/\$\s?\d|1500|8200/) // sin importes ni costos (FR-024)
      }

      // F-SVC-15: la reparación aparece en la pestaña de la ficha del cliente.
      await page.goto(`/clientes/show/${cliente.id}`)
      await page.getByRole('tab', { name: 'Reparaciones' }).click()
      await expect(page.getByRole('link', { name: /R-\d+/ }).or(page.getByText(/R-\d+/)).first()).toBeVisible()
      await contexto.close()
    } finally {
      if (orgId) await borrar(`organizaciones?id=eq.${orgId}`)
      if (userId) await borrarUsuario(userId)
    }
  })
})
