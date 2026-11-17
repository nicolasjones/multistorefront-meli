import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { altaUsuario, borrar, borrarUsuario, cabeceras, rest, serviceKey, sql, url } from './soporte/fixtures'

// F-CLI-06 (MSF-428, SC-005 y SC-006) con las dos tiendas del seed (mundojc.localhost y sanjavucho.localhost):
//  - invitación → definir contraseña → ingresar → «Salir» (SC-005);
//  - suspendida / sin cuenta en la tienda / no habilitada no entran y ven el MISMO mensaje que una contraseña errónea;
//  - recuperar responde igual con y sin cuenta (SC-006).
// Requiere el stack local (`pnpm dev:supabase`, que aplica `supabase/seed.sql`) y la web servida; siembra con la API
// admin desde Node (la service-role key nunca llega al navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el
// archivo se omite (no entra al CI público): ver docs/e2e-app.md. El enlace de definir contraseña se pide con
// `generate_link` (admin) en lugar de leer el correo: el envío del correo lo cubre el test de la Edge Function.

// Ids fijos de supabase/seed.sql (MSF-241).
const MUNDO = { host: 'mundojc.localhost', organizacion: '0f5eed00-0000-4000-8000-000000000001', empresa: '0f5eed01-0000-4000-8000-000000000001' } as const
const SAN = { host: 'sanjavucho.localhost', organizacion: '0f5eed00-0000-4000-8000-000000000002', empresa: '0f5eed01-0000-4000-8000-000000000002' } as const
type Tienda = typeof MUNDO | typeof SAN

const CLAVE = 'Clave-Segura-123!'
const GENERICO = 'Correo o contraseña incorrectos.'
const puerto = new URL(process.env.E2E_BASE_URL ?? `http://localhost:${Number(process.env.WEB_PORT) || 4300}`).port
const origen = (t: Tienda) => `http://${t.host}:${puerto}`

// Enlace de invitación/recuperación de la API admin de Auth (la firma es propia de este spec: no es una siembra).
async function generarEnlace(correo: string, redirectTo: string): Promise<string> {
  const r = await fetch(`${url}/auth/v1/admin/generate_link`, { method: 'POST', headers: cabeceras(), body: JSON.stringify({ type: 'recovery', email: correo, redirect_to: redirectTo }) })
  if (!r.ok) throw new Error(`Auth admin generate_link: ${r.status} ${await r.text()}`)
  return ((await r.json()) as { action_link: string }).action_link
}

type Sembrado = { correo: string; authId: string; clienteId: string }
const creados: Sembrado[] = []

// Cliente habilitado en `habilitado`, usuario de Auth (con o sin contraseña) y cuenta web en `cuenta` (opcional).
// `service_role` no escribe en `public.clientes_empresas` ni en `public.cuentas_cliente` (sin grant): la habilitación y la
// suspensión se siembran con `sql()`; el cliente (dominio) y el vínculo (RPC con EXECUTE para `service_role`) van por la REST.
async function sembrar(opciones: { habilitado: Tienda[]; cuenta?: { tienda: Tienda; estado: 'activa' | 'suspendida' }; conClave?: boolean }): Promise<Sembrado> {
  const sufijo = randomUUID().slice(0, 8)
  const correo = `cuenta-web-${sufijo}@example.com`
  const organizacion = (opciones.cuenta?.tienda ?? opciones.habilitado[0]).organizacion
  const [cliente] = await rest<{ id: string }>('clientes', {
    organizacion_id: organizacion, numero: 900000 + Math.floor(Math.random() * 90000), nombre: `E2E ${sufijo}`, correo, tipo: 'minorista',
  }, 'dominio')
  for (const t of opciones.habilitado) {
    await sql('insert into public.clientes_empresas (cliente_id, empresa_id, organizacion_id) values ($1, $2, $3)', [cliente.id, t.empresa, t.organizacion])
  }
  const authId = await altaUsuario(correo, opciones.conClave === false ? null : CLAVE)
  const sembrado = { correo, authId, clienteId: cliente.id }
  creados.push(sembrado)
  if (opciones.cuenta) {
    await rest('rpc/vincular_cuenta_cliente', { p_cliente: cliente.id, p_empresa: opciones.cuenta.tienda.empresa, p_auth_user: authId }, 'public', 'return=minimal')
    if (opciones.cuenta.estado === 'suspendida') {
      await sql("update public.cuentas_cliente set estado = 'suspendida' where cliente_id = $1 and empresa_id = $2", [cliente.id, opciones.cuenta.tienda.empresa])
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
      await borrarUsuario(s.authId)
      await borrar(`clientes?id=eq.${s.clienteId}`, 'dominio')
    }
  })

  test('invitación → definir contraseña → ingresar → salir (SC-005)', async ({ page }) => {
    const s = await sembrar({ habilitado: [MUNDO], cuenta: { tienda: MUNDO, estado: 'activa' }, conClave: false })
    const enlace = await generarEnlace(s.correo, `${origen(MUNDO)}/definir-contrasena`)

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
    // Un cliente pertenece a una sola organización (las empresas habilitadas deben ser de ella): habilitado en Mundo JC, sin cuenta web.
    const sinCuenta = await sembrar({ habilitado: [MUNDO] })
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
