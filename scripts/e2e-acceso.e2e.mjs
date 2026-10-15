// MSF-119 (T020): E2E de ingreso, recuperación y cierre de sesión (SC-001, SC-003).
// Maneja la web real (`pnpm dev:refine`, WEB_PORT) contra el stack local de Supabase
// (`pnpm dev:supabase`) con el servidor de `infra/playwright` (`pnpm dev:playwright`).
// Si algún servicio no responde falla (no se salta). NO forma parte de `pnpm test`.
// Variables opcionales: WEB_URL (def. http://127.0.0.1:$WEB_PORT|4300),
// PLAYWRIGHT_WS_ENDPOINT (def. ws://127.0.0.1:$PLAYWRIGHT_PORT|4303; `local` lanza
// un Chromium propio), SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { chromium } from 'playwright-core'

function entorno() {
  const env = { ...process.env }
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) {
    const salida = execSync('supabase status -o env', { encoding: 'utf8' })
    for (const linea of salida.split('\n')) {
      const m = linea.match(/^(\w+)="?(.*?)"?$/)
      if (m) env[m[1]] = m[2]
    }
    env.SUPABASE_URL ??= env.API_URL
    env.SUPABASE_ANON_KEY ??= env.ANON_KEY
    env.SUPABASE_SERVICE_ROLE_KEY ??= env.SERVICE_ROLE_KEY
  }
  return env
}

const env = entorno()
const base = env.SUPABASE_URL
const web = env.WEB_URL ?? `http://127.0.0.1:${env.WEB_PORT ?? 4300}`
const ws = env.PLAYWRIGHT_WS_ENDPOINT ?? `ws://127.0.0.1:${env.PLAYWRIGHT_PORT ?? 4303}`
const cabeceras = (clave) => ({ apikey: clave, authorization: `Bearer ${clave}`, 'content-type': 'application/json' })
const admin = cabeceras(env.SUPABASE_SERVICE_ROLE_KEY)

const password = 'Correcta-12345!'
const passwordNueva = 'Nueva-Clave-67890!'

async function rest(ruta, init = {}) {
  const r = await fetch(`${base}/rest/v1/${ruta}`, { ...init, headers: { ...admin, prefer: 'return=representation', ...init.headers } })
  assert.ok(r.ok, `REST ${ruta}: ${r.status} ${await r.text()}`)
  return r.json()
}

async function altaUsuario() {
  const correo = `acceso-e2e-${randomUUID()}@example.com`
  const alta = await fetch(`${base}/auth/v1/admin/users`, {
    method: 'POST',
    headers: admin,
    body: JSON.stringify({ email: correo, password, email_confirm: true }),
  })
  assert.equal(alta.status, 200, 'no se pudo crear el usuario de prueba')
  const { id } = await alta.json()
  const [org] = await rest('organizaciones', { method: 'POST', body: JSON.stringify({ nombre: `E2E acceso ${correo}` }) })
  await rest('usuarios_organizacion', {
    method: 'POST',
    body: JSON.stringify({ user_id: id, organizacion_id: org.id, rol_id: 'administrador' }),
  })
  return { correo, id, organizacionId: org.id }
}

async function baja({ id, organizacionId }) {
  await fetch(`${base}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: admin })
  await fetch(`${base}/rest/v1/organizaciones?id=eq.${organizacionId}`, { method: 'DELETE', headers: admin })
}

async function abrirNavegador() {
  return ws === 'local' ? chromium.launch() : chromium.connect(ws)
}

async function ingresar(page, correo, clave) {
  await page.goto(`${web}/login`)
  await page.getByLabel('Correo').fill(correo)
  await page.getByLabel('Contraseña').fill(clave)
  await page.getByRole('button', { name: 'Ingresar' }).click()
}

test('ingreso, cierre de sesión y recuperación de contraseña de punta a punta', async () => {
  const u = await altaUsuario()
  const navegador = await abrirNavegador()
  const contexto = await navegador.newContext()
  const page = await contexto.newPage()
  try {
    // Ingreso con contraseña incorrecta: sigue en /login (SC-001).
    await ingresar(page, u.correo, 'incorrecta-12345')
    await page.waitForTimeout(1000)
    assert.match(new URL(page.url()).pathname, /\/login$/, 'con credenciales inválidas no debe entrar')

    // Ingreso correcto: sale de /login y aparece el menú de cuenta.
    await ingresar(page, u.correo, password)
    await page.getByRole('button', { name: /^Cuenta de / }).waitFor()
    assert.doesNotMatch(new URL(page.url()).pathname, /\/login$/)

    // Cierre de sesión: vuelve al ingreso y una ruta protegida ya no es accesible (SC-003).
    await page.getByRole('button', { name: /^Cuenta de / }).click()
    await page.getByRole('menuitem', { name: 'Cerrar sesión' }).click()
    await page.waitForURL(/\/login$/)
    await page.goto(`${web}/usuarios`)
    await page.waitForURL(/\/login/)

    // Recuperación: aviso neutro y enlace de un solo uso vía Admin API (sin correo real).
    await page.goto(`${web}/acceso/solicitar-recuperacion`)
    await page.getByLabel('Email').fill(u.correo)
    await page.getByRole('button', { name: 'Enviar enlace de recuperacion' }).click()
    await page.getByText('Si existe una cuenta para ese correo').waitFor()

    const enlace = await fetch(`${base}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: admin,
      body: JSON.stringify({
        type: 'recovery',
        email: u.correo,
        redirect_to: `${web}/acceso/definir-contrasena?origen=recuperacion`,
      }),
    })
    assert.equal(enlace.status, 200, 'no se pudo generar el enlace de recuperación')
    const { action_link: actionLink } = await enlace.json()

    await page.goto(actionLink)
    await page.getByLabel('Nueva contraseña').fill(passwordNueva)
    await page.getByLabel('Confirmar contraseña').fill(passwordNueva)
    await page.getByRole('button', { name: 'Guardar contraseña' }).click()
    await page.waitForURL((url) => !url.pathname.includes('/acceso/definir-contrasena'))

    // Tras redefinir: la contraseña vieja ya no sirve y la nueva sí.
    const token = (clave) =>
      fetch(`${base}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: cabeceras(env.SUPABASE_ANON_KEY),
        body: JSON.stringify({ email: u.correo, password: clave }),
      })
    assert.equal((await token(password)).status, 400, 'la contraseña anterior no debe seguir vigente')
    assert.equal((await token(passwordNueva)).status, 200, 'la contraseña nueva debe permitir ingresar')

    // El enlace es de un solo uso: reutilizarlo no deja definir otra contraseña.
    const contexto2 = await navegador.newContext()
    const page2 = await contexto2.newPage()
    await page2.goto(actionLink)
    await page2.waitForURL(/solicitar-recuperacion|login/, { timeout: 15000 })
  } finally {
    await navegador.close()
    await baja(u)
  }
})
