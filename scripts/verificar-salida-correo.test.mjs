// MSF-532 (FR-012b, SC-004): el guion de verificación de salida del correo no puede dar un verde falso.
// Se corre el guion real (scripts/verificar-salida-correo.mjs) contra un servidor local que imita a Auth,
// la Edge Function `solicitar-acceso` y la API de Mailpit: el guion queda probado sin mandar ningún
// correo y sin tocar un servidor real.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { manejar } from '../supabase/functions/solicitar-acceso/handler.ts'

const RAIZ = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(RAIZ, 'verificar-salida-correo.mjs')
const CORREO_PRUEBA = 'nicolas.m.jones@gmail.com'

/** Servidor local que imita Auth, la Edge Function y la API de Mailpit. */
const levantar = async ({ estadoToken = 200, respuestaFuncion = { cuerpo: {} }, mensajes = [] }) => {
  const servidor = http.createServer((req, res) => {
    const responder = (codigo, cuerpo) => {
      res.writeHead(codigo, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(cuerpo))
    }
    const url = req.url ?? ''
    if (url.startsWith('/auth/v1/token')) {
      return estadoToken === 200 ? responder(200, { access_token: 'token' }) : responder(estadoToken, { error: 'invalid' })
    }
    if (url.startsWith('/functions/v1/solicitar-acceso')) {
      return responder(respuestaFuncion.codigo ?? 200, respuestaFuncion.cuerpo)
    }
    if (url.startsWith('/api/v1/messages')) return responder(200, { messages: mensajes })
    return responder(404, { error: 'ruta desconocida' })
  })
  await new Promise((resolver) => servidor.listen(0, '127.0.0.1', resolver))
  const { port } = servidor.address()
  return {
    url: `http://127.0.0.1:${port}`,
    cerrar: () => new Promise((resolver) => servidor.close(resolver)),
  }
}

const correr = (env) =>
  new Promise((resolver) => {
    const hijo = spawn(process.execPath, [SCRIPT], {
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let salida = ''
    let error = ''
    hijo.stdout.on('data', (d) => { salida += d })
    hijo.stderr.on('data', (d) => { error += d })
    hijo.on('close', (codigo) => resolver({ codigo, salida, error }))
  })

const entorno = (base, extra = {}) => ({
  AUTH_URL: `${base.url}/auth/v1`,
  FUNCTIONS_URL: `${base.url}/functions/v1`,
  SUPABASE_ANON_KEY: 'clave-anon',
  ACCESO_EMAIL: 'persona@ejemplo.com',
  ACCESO_PASSWORD: 'secreta',
  ...extra,
})

test('la Edge Function sigue respondiendo el contrato {resultado, nuevo} que usa el guion', async () => {
  // El guion decide si la corrida avisó con el campo `nuevo` de la respuesta: se comprueba contra el
  // handler real (no contra su texto) que un pedido ya notificado responde `nuevo: false`.
  const deps = {
    verificarJwt: async () => ({ id: 'u-1', email: 'ana@ejemplo.com' }),
    caller: () => ({
      rpc: async () => ({
        data: { id: 'sol-1', organizacion_id: 'org-1', nuevo: false, correo_enviado: true },
        error: null,
      }),
    }),
    datos: {
      reclamarEnvio: async () => { throw new Error('no debe reclamar el envío de un pedido ya notificado') },
      liberarEnvio: async () => {},
      administradoresActivos: async () => [],
      nombreVisible: async () => null,
    },
    enviar: async () => { throw new Error('no debe volver a enviar el aviso del día') },
  }
  const res = await manejar(new Request('http://localhost/solicitar-acceso', {
    method: 'POST',
    headers: { Authorization: 'Bearer valido', 'Content-Type': 'application/json' },
    body: JSON.stringify({ seccion: 'rentabilidad' }),
  }), deps)

  assert.deepEqual(await res.json(), { resultado: 'solicitud_enviada', nuevo: false })
})

test('sin CASILLA ni MAILPIT_URL el guion no corre: falta la variable', async () => {
  const base = await levantar({})
  try {
    const r = await correr(entorno(base))
    assert.equal(r.codigo, 2)
    assert.match(r.error, /Falta la variable CORREO_PRUEBA/)
  } finally {
    await base.cerrar()
  }
})

test('sin una variable de entorno obligatoria el guion falla con el código de uso', async () => {
  const base = await levantar({})
  try {
    const r = await correr({ FUNCTIONS_URL: `${base.url}/functions/v1` })
    assert.equal(r.codigo, 2)
    assert.match(r.error, /Falta la variable AUTH_URL/)
  } finally {
    await base.cerrar()
  }
})

test('si no se puede iniciar sesión el guion falla sin dar verde', async () => {
  const base = await levantar({ estadoToken: 401 })
  try {
    const r = await correr(entorno(base, { CORREO_PRUEBA }))
    assert.equal(r.codigo, 1)
    assert.match(r.error, /No se pudo iniciar sesión/)
  } finally {
    await base.cerrar()
  }
})

test('sin administrador activo el guion falla sin dar verde', async () => {
  const base = await levantar({ respuestaFuncion: { cuerpo: { resultado: 'sin_administradores', nuevo: true } } })
  try {
    const r = await correr(entorno(base, { CORREO_PRUEBA }))
    assert.equal(r.codigo, 1)
    assert.match(r.error, /no tiene administrador activo/)
  } finally {
    await base.cerrar()
  }
})

test('una respuesta inesperada de la función no se toma como envío', async () => {
  const base = await levantar({ respuestaFuncion: { cuerpo: { resultado: 'otra_cosa' } } })
  try {
    const r = await correr(entorno(base, { CORREO_PRUEBA }))
    assert.equal(r.codigo, 1)
    assert.match(r.error, /no confirmó el envío/)
  } finally {
    await base.cerrar()
  }
})

test('el pedido del día ya notificado no se toma como verificación (idempotencia)', async () => {
  const base = await levantar({ respuestaFuncion: { cuerpo: { resultado: 'solicitud_enviada', nuevo: false } } })
  try {
    const r = await correr(entorno(base, { CORREO_PRUEBA }))
    assert.equal(r.codigo, 1)
    assert.notEqual(r.codigo, 0)
    assert.match(r.error, /idempotencia/)
  } finally {
    await base.cerrar()
  }
})

test('en el servidor la entrega queda pendiente de confirmación manual: nunca verde', async () => {
  const base = await levantar({ respuestaFuncion: { cuerpo: { resultado: 'solicitud_enviada', nuevo: true } } })
  try {
    const r = await correr(entorno(base, { CORREO_PRUEBA }))
    assert.equal(r.codigo, 3)
    assert.notEqual(r.codigo, 0)
    assert.match(r.salida, /VERIFICACIÓN MANUAL PENDIENTE/)
    assert.match(r.salida, new RegExp(CORREO_PRUEBA))
  } finally {
    await base.cerrar()
  }
})

test('en local, con el aviso en Mailpit, la salida queda verificada', async () => {
  const base = await levantar({
    respuestaFuncion: { cuerpo: { resultado: 'solicitud_enviada', nuevo: true } },
    mensajes: [{ Subject: 'Solicitud de acceso a Rentabilidad', Created: new Date().toISOString(), To: [{ Address: CORREO_PRUEBA }] }],
  })
  try {
    const r = await correr(entorno(base, { MAILPIT_URL: base.url }))
    assert.equal(r.codigo, 0)
    assert.match(r.salida, /OK: el correo/)
  } finally {
    await base.cerrar()
  }
})

test('en local, sin aviso nuevo en Mailpit, no hay verde', async () => {
  const base = await levantar({
    respuestaFuncion: { cuerpo: { resultado: 'solicitud_enviada', nuevo: true } },
    mensajes: [{ Subject: 'Solicitud de acceso a Rentabilidad', Created: new Date(Date.now() - 600000).toISOString(), To: [{ Address: CORREO_PRUEBA }] }],
  })
  try {
    const r = await correr(entorno(base, { MAILPIT_URL: base.url }))
    assert.equal(r.codigo, 1)
    assert.notEqual(r.codigo, 0)
    assert.match(r.error, /no apareció en Mailpit/)
  } finally {
    await base.cerrar()
  }
})
