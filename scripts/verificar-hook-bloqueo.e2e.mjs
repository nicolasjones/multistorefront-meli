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
    // Se imprime el código real que devuelve GoTrue al rechazar el hook. El cliente web
    // no depende de él: con invalid_credentials registrar_fallo_acceso devuelve el
    // bloqueo vigente, y con cualquier otro código se consulta bloqueo_acceso_hasta.
    assert.ok(bloqueado.cuerpo.error_code, 'el rechazo del hook trae error_code')
    console.log(`rechazo del hook: status=${bloqueado.status} error_code=${bloqueado.cuerpo.error_code}`)

    // Bloqueado + contraseña inválida: se rechaza igual, con el mismo mensaje, sin
    // distinguir la contraseña correcta de la incorrecta (frena la fuerza bruta).
    const maloBloqueado = await token(correo, 'incorrecta')
    assert.ok(maloBloqueado.status >= 400, 'bloqueado, una contraseña inválida también se rechaza')
    assert.equal(maloBloqueado.cuerpo.access_token, undefined)
    assert.match(JSON.stringify(maloBloqueado.cuerpo), /Demasiados intentos/, 'mismo mensaje que con la correcta')
    assert.equal(maloBloqueado.cuerpo.error_code, bloqueado.cuerpo.error_code, 'misma respuesta con contraseña válida e inválida')
  } finally {
    await fetch(`${base}/auth/v1/admin/users/${id}`, {
      method: 'DELETE',
      headers: cabeceras(env.SUPABASE_SERVICE_ROLE_KEY),
    })
  }
})

async function crearUsuario(correo, password) {
  const alta = await fetch(`${base}/auth/v1/admin/users`, {
    method: 'POST',
    headers: cabeceras(env.SUPABASE_SERVICE_ROLE_KEY),
    body: JSON.stringify({ email: correo, password, email_confirm: true }),
  })
  assert.equal(alta.status, 200, 'no se pudo crear el usuario de prueba')
  return (await alta.json()).id
}

const borrarUsuario = (id) =>
  fetch(`${base}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: cabeceras(env.SUPABASE_SERVICE_ROLE_KEY) })

test('10 intentos incorrectos en paralelo no eluden el tope: después el correcto se rechaza', async () => {
  const correo = `hook-e2e-par-${randomUUID()}@example.com`
  const password = 'Correcta-12345'
  const id = await crearUsuario(correo, password)
  try {
    const resultados = await Promise.all(Array.from({ length: 10 }, () => token(correo, 'incorrecta')))
    assert.ok(resultados.every((r) => r.cuerpo.access_token === undefined))
    const bloqueado = await token(correo, password)
    assert.equal(bloqueado.cuerpo.access_token, undefined, 'tras 10 fallos en paralelo no debe emitirse token')
    assert.match(JSON.stringify(bloqueado.cuerpo), /Demasiados intentos/)
  } finally {
    await borrarUsuario(id)
  }
})

test('una contraseña válida con fallos previos (menos de 5) reinicia el contador', async () => {
  const correo = `hook-e2e-reset-${randomUUID()}@example.com`
  const password = 'Correcta-12345'
  const id = await crearUsuario(correo, password)
  try {
    for (let i = 0; i < 4; i++) await token(correo, 'incorrecta')
    assert.equal((await token(correo, password)).status, 200, 'con 4 fallos previos la correcta ingresa')
    // Si el contador no se hubiera reiniciado, estos 4 fallos sumarían 8 y bloquearían.
    for (let i = 0; i < 4; i++) await token(correo, 'incorrecta')
    assert.equal((await token(correo, password)).status, 200, 'tras el reinicio 4 fallos más no bloquean')
  } finally {
    await borrarUsuario(id)
  }
})
