// MSF-470 (T022): prueba de integración del Auth Hook de bloqueo contra el stack
// local (`pnpm dev:supabase`). Hace llamados directos a /auth/v1/token, sin pasar por
// la UI: 5 contraseñas incorrectas y un 6.º con la correcta deben dar rechazo.
// Si el stack no responde falla (no se salta): un hook inactivo no puede pasar en verde.
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

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
const cabeceras = (clave) => ({ apikey: clave, authorization: `Bearer ${clave}`, 'content-type': 'application/json' })

async function token(correo, password) {
  const r = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: cabeceras(env.SUPABASE_ANON_KEY),
    body: JSON.stringify({ email: correo, password }),
  })
  return { status: r.status, cuerpo: await r.json() }
}

test('un llamado directo a /auth/v1/token queda bloqueado tras 5 fallos, aun con la contraseña correcta', async () => {
  const correo = `hook-e2e-${randomUUID()}@example.com`
  const password = 'Correcta-12345'
  const alta = await fetch(`${base}/auth/v1/admin/users`, {
    method: 'POST',
    headers: cabeceras(env.SUPABASE_SERVICE_ROLE_KEY),
    body: JSON.stringify({ email: correo, password, email_confirm: true }),
  })
  assert.equal(alta.status, 200, 'no se pudo crear el usuario de prueba')
  const { id } = await alta.json()

  try {
    const ok = await token(correo, password)
    assert.equal(ok.status, 200, 'con la contraseña correcta y sin fallos previos debe ingresar')

    for (let i = 1; i <= 5; i++) {
      const mal = await token(correo, 'incorrecta')
      assert.equal(mal.status, 400, `fallo ${i}: Auth debe responder invalid_credentials`)
      assert.equal(mal.cuerpo.error_code, 'invalid_credentials')
    }

    const bloqueado = await token(correo, password)
    assert.ok(bloqueado.status >= 400, 'el 6.º intento con la contraseña correcta debe rechazarse')
    assert.equal(bloqueado.cuerpo.access_token, undefined, 'no debe emitirse un token')
    assert.match(JSON.stringify(bloqueado.cuerpo), /Demasiados intentos/, 'el rechazo trae el mensaje del hook')
  } finally {
    await fetch(`${base}/auth/v1/admin/users/${id}`, {
      method: 'DELETE',
      headers: cabeceras(env.SUPABASE_SERVICE_ROLE_KEY),
    })
  }
})
