import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

// F-CLI-06 (MSF-428, SC-005 y SC-006) con las dos tiendas del seed (mundojc.localhost y sanjavucho.localhost):
//  - invitación → definir contraseña → ingresar → «Salir» (SC-005);
//  - suspendida / sin cuenta en la tienda / no habilitada no entran y ven el MISMO mensaje que una contraseña errónea;
//  - recuperar responde igual con y sin cuenta (SC-006).
// Requiere el stack local (`pnpm dev:supabase`, que aplica `supabase/seed.sql`) y la web servida; siembra con la API
// admin desde Node (la service-role key nunca llega al navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el
// archivo se omite (no entra al CI público): ver docs/e2e-app.md. El enlace de definir contraseña se pide con
// `generate_link` (admin) en lugar de leer el correo: el envío del correo lo cubre el test de la Edge Function.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// La service-role key escribe datos: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de cuenta web: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
}

// Ids fijos de supabase/seed.sql (MSF-241).
const MUNDO = { host: 'mundojc.localhost', organizacion: '0f5eed00-0000-4000-8000-000000000001', empresa: '0f5eed01-0000-4000-8000-000000000001' } as const
const SAN = { host: 'sanjavucho.localhost', organizacion: '0f5eed00-0000-4000-8000-000000000002', empresa: '0f5eed01-0000-4000-8000-000000000002' } as const
type Tienda = typeof MUNDO | typeof SAN

const CLAVE = 'Clave-Segura-123!'
const GENERICO = 'Correo o contraseña incorrectos.'
const puerto = new URL(process.env.E2E_BASE_URL ?? `http://localhost:${Number(process.env.WEB_PORT) || 4300}`).port
const origen = (t: Tienda) => `http://${t.host}:${puerto}`

const cabeceras = (perfil = 'public') => ({
  apikey: serviceKey ?? '',
  authorization: `Bearer ${serviceKey}`,
  'content-type': 'application/json',
  'content-profile': perfil,
  'accept-profile': perfil,
})

async function rest<T>(metodo: string, ruta: string, cuerpo?: unknown): Promise<T> {
  const r = await fetch(`${url}/rest/v1/${ruta}`, {
    method: metodo,
    headers: { ...cabeceras(), prefer: 'return=representation' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
  if (!r.ok) throw new Error(`REST ${metodo} ${ruta}: ${r.status} ${await r.text()}`)
  return (await r.json().catch(() => null)) as T
}

async function admin<T>(ruta: string, cuerpo: unknown): Promise<T> {
  const r = await fetch(`${url}/auth/v1/admin/${ruta}`, { method: 'POST', headers: cabeceras(), body: JSON.stringify(cuerpo) })
  if (!r.ok) throw new Error(`Auth admin ${ruta}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T
}

type Sembrado = { correo: string; authId: string; clienteId: string }
const creados: Sembrado[] = []

// Cliente habilitado en `habilitado`, usuario de Auth (con o sin contraseña) y cuenta web en `cuenta` (opcional).
async function sembrar(opciones: { habilitado: Tienda[]; cuenta?: { tienda: Tienda; estado: 'activa' | 'suspendida' }; conClave?: boolean }): Promise<Sembrado> {
  const sufijo = randomUUID().slice(0, 8)
  const correo = `cuenta-web-${sufijo}@example.com`
  const organizacion = (opciones.cuenta?.tienda ?? opciones.habilitado[0]).organizacion
  const [cliente] = await rest<{ id: string }[]>('POST', 'clientes', {
    organizacion_id: organizacion, numero: 900000 + Math.floor(Math.random() * 90000), nombre: `E2E ${sufijo}`, correo, tipo: 'minorista',
  })
  for (const t of opciones.habilitado) {
    await rest('POST', 'clientes_empresas', { cliente_id: cliente.id, empresa_id: t.empresa, organizacion_id: t.organizacion })
  }
  const usuario = await admin<{ id: string }>('users', { email: correo, email_confirm: true, ...(opciones.conClave === false ? {} : { password: CLAVE }) })
  const sembrado = { correo, authId: usuario.id, clienteId: cliente.id }
  creados.push(sembrado)
  if (opciones.cuenta) {
    await rest('POST', 'rpc/vincular_cuenta_cliente', { p_cliente: cliente.id, p_empresa: opciones.cuenta.tienda.empresa, p_auth_user: usuario.id })
    if (opciones.cuenta.estado === 'suspendida') {
      await rest('PATCH', `cuentas_cliente?cliente_id=eq.${cliente.id}&empresa_id=eq.${opciones.cuenta.tienda.empresa}`, { estado: 'suspendida' })
    }
  }
  return sembrado
}

async function ingresar(page: Page, tienda: Tienda, correo: string, clave: string) {
  await page.goto(`${origen(tienda)}/ingresar`)
  await page.getByLabel(/^Correo/).fill(correo)
  await page.getByLabel(/^Contraseña/).fill(clave)
  await page.getByRole('button', { name: 'Ingresar' }).click()
}

test.describe('Cuenta web del cliente · ingreso y recuperación (SC-005, SC-006)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test.afterAll(async () => {
    for (const s of creados) {
      await fetch(`${url}/auth/v1/admin/users/${s.authId}`, { method: 'DELETE', headers: cabeceras() }).catch(() => undefined)
      await fetch(`${url}/rest/v1/clientes?id=eq.${s.clienteId}`, { method: 'DELETE', headers: cabeceras() }).catch(() => undefined)
    }
  })

  test('invitación → definir contraseña → ingresar → salir (SC-005)', async ({ page }) => {
    const s = await sembrar({ habilitado: [MUNDO], cuenta: { tienda: MUNDO, estado: 'activa' }, conClave: false })
    const { action_link: enlace } = await admin<{ action_link: string }>('generate_link', {
      type: 'recovery', email: s.correo, redirect_to: `${origen(MUNDO)}/definir-contrasena`,
    })

    await page.goto(enlace)
    await expect(page).toHaveURL(new RegExp(`^${origen(MUNDO)}/definir-contrasena`))
    await page.getByLabel(/^Nueva contraseña/).fill(CLAVE)
    await page.getByLabel(/^Confirmar contraseña/).fill(CLAVE)
    await page.getByRole('button', { name: 'Guardar y entrar' }).click()

    // Queda ingresado en su tienda: el encabezado ofrece «Salir».
    await expect(page.getByRole('button', { name: 'Salir' })).toBeVisible()
    await page.getByRole('button', { name: 'Salir' }).click()
    await expect(page.getByRole('link', { name: 'Ingresar' })).toBeVisible()

    // Y con la contraseña definida ingresa de nuevo.
    await ingresar(page, MUNDO, s.correo, CLAVE)
    await expect(page.getByRole('button', { name: 'Salir' })).toBeVisible()
  })

  test('el enlace vencido o usado ofrece recuperar la contraseña', async ({ page }) => {
    await page.goto(`${origen(MUNDO)}/definir-contrasena`)
    await expect(page.getByText('El enlace venció o ya se usó. Pedí uno nuevo para continuar.')).toBeVisible()
    await page.getByRole('link', { name: 'Recuperar contraseña' }).click()
    await expect(page.getByRole('heading', { name: 'Recuperar contraseña' })).toBeVisible()
  })

  test('suspendida, sin cuenta en la tienda y no habilitada no entran, con el mismo mensaje que una clave errónea', async ({ page }) => {
    const suspendida = await sembrar({ habilitado: [MUNDO], cuenta: { tienda: MUNDO, estado: 'suspendida' } })
    const sinCuenta = await sembrar({ habilitado: [MUNDO, SAN], cuenta: { tienda: SAN, estado: 'activa' } })
    const noHabilitada = await sembrar({ habilitado: [SAN], cuenta: { tienda: SAN, estado: 'activa' } })
    const activa = await sembrar({ habilitado: [MUNDO], cuenta: { tienda: MUNDO, estado: 'activa' } })

    for (const [correo, clave] of [[suspendida.correo, CLAVE], [sinCuenta.correo, CLAVE], [noHabilitada.correo, CLAVE], [activa.correo, 'Otra-clave-1!']] as const) {
      await ingresar(page, MUNDO, correo, clave)
      await expect(page.getByText(GENERICO)).toBeVisible()
      await expect(page.getByRole('button', { name: 'Salir' })).toHaveCount(0)
    }
    // La cuenta activa de Mundo JC tampoco entra en San Javucho (es otra tienda).
    await ingresar(page, SAN, activa.correo, CLAVE)
    await expect(page.getByText(GENERICO)).toBeVisible()
    // Y con la clave correcta en su tienda sí entra.
    await ingresar(page, MUNDO, activa.correo, CLAVE)
    await expect(page.getByRole('button', { name: 'Salir' })).toBeVisible()
  })

  test('recuperar responde igual con y sin cuenta (SC-006)', async ({ page, request }) => {
    const s = await sembrar({ habilitado: [MUNDO], cuenta: { tienda: MUNDO, estado: 'activa' } })
    const sonda = await request.post(`${url}/functions/v1/recuperar-clave-cliente`, { data: {}, headers: { apikey: serviceKey ?? '' }, failOnStatusCode: false })
    test.skip(sonda.status() === 404 || sonda.status() >= 502, 'La Edge Function recuperar-clave-cliente no está servida (`supabase functions serve`).')

    const avisos: string[] = []
    for (const correo of [s.correo, `nadie-${randomUUID().slice(0, 8)}@example.com`]) {
      await page.goto(`${origen(MUNDO)}/recuperar-contrasena`)
      await page.getByLabel(/^Correo/).fill(correo)
      await page.getByRole('button', { name: 'Enviar enlace' }).click()
      avisos.push(await page.getByRole('alert').innerText())
    }
    expect(avisos[0]).toContain('Si existe una cuenta')
    expect(avisos[1]).toBe(avisos[0])
  })
})
