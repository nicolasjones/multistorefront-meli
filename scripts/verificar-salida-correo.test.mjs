// MSF-532 (FR-012b, SC-004): el guion de verificación de salida del correo no puede dar un verde falso.
// Se corre el guion real (scripts/verificar-salida-correo.mjs) contra un servidor local que imita a Auth,
// la Edge Function `solicitar-acceso` y la API de Mailpit: el guion queda probado sin mandar ningún
// correo y sin tocar un servidor real.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { manejar } from '../supabase/functions/solicitar-acceso/handler.ts'

const RAIZ = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(RAIZ, 'verificar-salida-correo.mjs')
const CORREO_PRUEBA = 'nicolas.m.jones@gmail.com'

/**
 * Servidor local que imita Auth, la Edge Function y la API de Mailpit.
 * `mensajes` puede ser una función: el mensaje se crea en el momento de la consulta (como en Mailpit
 * real), no antes de arrancar el guion (si no, la ventana de 5 s del guion lo descarta y el test falla
 * de forma intermitente cuando el runner tarda).
 */
const levantar = async ({ estadoToken = 200, respuestaFuncion = { cuerpo: {} }, mensajes = [], mailpitColgado = false }) => {
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
    // Mailpit colgado: acepta la conexión y nunca responde (el guion tiene que cortar por su cuenta).
    if (url.startsWith('/api/v1/messages') && mailpitColgado) return
    if (url.startsWith('/api/v1/messages')) return responder(200, { messages: typeof mensajes === 'function' ? mensajes() : mensajes })
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

/** Mensaje de Mailpit creado en el momento de la consulta (como el Mailpit real). */
const avisoEnMailpit = () => [{
  Subject: 'Solicitud de acceso a Rentabilidad',
  Created: new Date().toISOString(),
  To: [{ Address: CORREO_PRUEBA }],
}]

test('la Edge Function sigue respondiendo el contrato {resultado, nuevo, enviado} que usa el guion', async () => {
  // El guion decide si la corrida envió con el campo `enviado` de la respuesta: se comprueba contra el
  // handler real (no contra su texto) que cada camino dice la verdad.
  const pedir = (registro) => manejar(new Request('http://localhost/solicitar-acceso', {
    method: 'POST',
    headers: { Authorization: 'Bearer valido', 'Content-Type': 'application/json' },
    body: JSON.stringify({ seccion: 'rentabilidad' }),
  }), {
    verificarJwt: async () => ({ id: 'u-1', email: 'ana@ejemplo.com' }),
    caller: () => ({ rpc: async () => ({ data: registro, error: null }) }),
    datos: {
      reclamarEnvio: async () => true,
      liberarEnvio: async () => {},
      administradoresActivos: async () => ['admin@ejemplo.com'],
      nombreVisible: async () => 'Ana',
    },
    enviar: async () => {},
  })

  // El aviso ya salió hoy: esta corrida no manda nada.
  const yaNotificado = await pedir({ id: 'sol-1', organizacion_id: 'org-1', nuevo: false, correo_enviado: true })
  assert.deepEqual(await yaNotificado.json(), { resultado: 'solicitud_enviada', nuevo: false, enviado: false })

  // El aviso sale ahora: esta corrida manda y el SMTP lo acepta.
  const enviado = await pedir({ id: 'sol-2', organizacion_id: 'org-1', nuevo: true, correo_enviado: false })
  assert.deepEqual(await enviado.json(), { resultado: 'solicitud_enviada', nuevo: true, enviado: true })
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
  const base = await levantar({ respuestaFuncion: { cuerpo: { resultado: 'sin_administradores', nuevo: true, enviado: false } } })
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

test('una función vieja que no informa `enviado` no se toma como verificación', async () => {
  const base = await levantar({ respuestaFuncion: { cuerpo: { resultado: 'solicitud_enviada', nuevo: true } } })
  try {
    const r = await correr(entorno(base, { CORREO_PRUEBA }))
    assert.notEqual(r.codigo, 0)
    assert.equal(r.codigo, 1)
    assert.match(r.error, /no dice si esta corrida envió el aviso/)
  } finally {
    await base.cerrar()
  }
})

test('el pedido del día ya notificado no se toma como verificación (idempotencia)', async () => {
  const base = await levantar({ respuestaFuncion: { cuerpo: { resultado: 'solicitud_enviada', nuevo: false, enviado: false } } })
  try {
    const r = await correr(entorno(base, { CORREO_PRUEBA }))
    assert.equal(r.codigo, 1)
    assert.notEqual(r.codigo, 0)
    assert.match(r.error, /idempotencia/)
  } finally {
    await base.cerrar()
  }
})

test('otra invocación que ganó el reclamo del envío no se toma como verificación', async () => {
  // `nuevo: true` pero `enviado: false`: el pedido se creó en esta corrida, pero otra la está avisando.
  const base = await levantar({ respuestaFuncion: { cuerpo: { resultado: 'solicitud_enviada', nuevo: true, enviado: false } } })
  try {
    const r = await correr(entorno(base, { CORREO_PRUEBA }))
    assert.equal(r.codigo, 1)
    assert.notEqual(r.codigo, 0)
    assert.match(r.error, /otra invocación/)
    assert.doesNotMatch(r.salida, /SMTP del servidor lo aceptó/)
  } finally {
    await base.cerrar()
  }
})

test('en el servidor la entrega queda pendiente de confirmación manual: nunca verde', async () => {
  const base = await levantar({ respuestaFuncion: { cuerpo: { resultado: 'solicitud_enviada', nuevo: true, enviado: true } } })
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

test('el reintento de un envío fallido sí sale: no se informa un falso «no se envió»', async () => {
  // El pedido del día ya existía y el envío anterior falló (sin relay): el reintento SÍ manda el aviso.
  // La respuesta trae `nuevo: false` pero `enviado: true`: el guion no puede decir que no se envió nada.
  const base = await levantar({ respuestaFuncion: { cuerpo: { resultado: 'solicitud_enviada', nuevo: false, enviado: true } } })
  try {
    const r = await correr(entorno(base, { CORREO_PRUEBA }))
    assert.equal(r.codigo, 3)
    assert.match(r.salida, /SMTP del servidor lo aceptó/)
    assert.doesNotMatch(r.error, /NO envió el aviso/)
    assert.doesNotMatch(`${r.salida}${r.error}`, /Repetí con otra SECCION/)
  } finally {
    await base.cerrar()
  }
})

test('los códigos de salida tienen un solo dueño: la tabla del registro', async () => {
  // El guion y las páginas de técnica apuntan a `docs/verificacion-salida-correo.md`; si alguien copia
  // la tabla a otro lado, el dato queda con dos dueños que se desincronizan.
  const leer = (ruta) => readFile(path.join(RAIZ, '..', ruta), 'utf8')
  const pagina = await leer('docs/verificacion-salida-correo.md')
  assert.deepEqual([...pagina.matchAll(/^\| `(\d)` \|/gm)].map((m) => m[1]), ['0', '1', '2', '3'])

  const guion = await leer('scripts/verificar-salida-correo.mjs')
  assert.deepEqual([...guion.matchAll(/^\/\/   (\d) =/gm)].map((m) => m[1]), ['0', '1', '2', '3'])

  for (const ruta of ['docs/tecnico/operacion.md', 'docs/tecnico/perfil-y-permisos.md']) {
    const texto = await leer(ruta)
    assert.doesNotMatch(texto, /^\| `\d` \|/m)
    assert.match(texto, /verificacion-salida-correo\.md/)
  }
})

test('en local, con el aviso en Mailpit, la salida queda verificada', async () => {
  const base = await levantar({
    respuestaFuncion: { cuerpo: { resultado: 'solicitud_enviada', nuevo: true, enviado: true } },
    mensajes: avisoEnMailpit,
  })
  try {
    const r = await correr(entorno(base, { MAILPIT_URL: base.url }))
    assert.equal(r.codigo, 0)
    assert.match(r.salida, /OK: el correo/)
  } finally {
    await base.cerrar()
  }
})

test('en local, con CORREO_PRUEBA, un aviso dirigido a otra casilla no da verde', async () => {
  const base = await levantar({
    respuestaFuncion: { cuerpo: { resultado: 'solicitud_enviada', nuevo: true, enviado: true } },
    mensajes: () => [{ Subject: 'Solicitud de acceso a Rentabilidad', Created: new Date().toISOString(), To: [{ Address: 'otra@ejemplo.com' }] }],
  })
  try {
    const r = await correr(entorno(base, { MAILPIT_URL: base.url, CORREO_PRUEBA }))
    assert.equal(r.codigo, 1)
    assert.doesNotMatch(r.salida, /OK: el correo/)
  } finally {
    await base.cerrar()
  }
})

test('en local, con CORREO_PRUEBA, el aviso dirigido a esa casilla (sin distinguir mayúsculas) da verde', async () => {
  const base = await levantar({
    respuestaFuncion: { cuerpo: { resultado: 'solicitud_enviada', nuevo: true, enviado: true } },
    mensajes: avisoEnMailpit,
  })
  try {
    const r = await correr(entorno(base, { MAILPIT_URL: base.url, CORREO_PRUEBA: CORREO_PRUEBA.toUpperCase() }))
    assert.equal(r.codigo, 0)
  } finally {
    await base.cerrar()
  }
})

test('en local, un aviso en Mailpit que no salió de esta corrida no da verde', async () => {
  // Reproduce el verde falso: la función no envió nada (`enviado: false`) pero hay un «Solicitud de acceso»
  // en Mailpit. El `0` tiene que ser prueba de ESTA corrida.
  const base = await levantar({
    respuestaFuncion: { cuerpo: { resultado: 'solicitud_enviada', nuevo: false, enviado: false } },
    mensajes: avisoEnMailpit,
  })
  try {
    const r = await correr(entorno(base, { MAILPIT_URL: base.url }))
    assert.notEqual(r.codigo, 0)
    assert.equal(r.codigo, 1)
    assert.doesNotMatch(r.salida, /OK: el correo/)
  } finally {
    await base.cerrar()
  }
})

test('en local, sin aviso en Mailpit, no hay verde', async () => {
  const base = await levantar({
    respuestaFuncion: { cuerpo: { resultado: 'solicitud_enviada', nuevo: true, enviado: true } },
    mensajes: [],
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

test('un MAILPIT_TIMEOUT_MS no finito o enorme no rompe el guion: cae al tope por omisión o al máximo', async () => {
  // `AbortSignal.timeout(Infinity)` lanza TypeError: sin el arreglo el guion se caía antes de consultar Mailpit.
  for (const valor of ['Infinity', '-Infinity', 'NaN', '', '1e12']) {
    const base = await levantar({
      respuestaFuncion: { cuerpo: { resultado: 'solicitud_enviada', nuevo: true, enviado: true } },
      mensajes: avisoEnMailpit,
    })
    try {
      const r = await correr(entorno(base, { MAILPIT_URL: base.url, MAILPIT_TIMEOUT_MS: valor }))
      assert.equal(r.codigo, 0, `MAILPIT_TIMEOUT_MS=${JSON.stringify(valor)}: ${r.error}`)
      assert.match(r.salida, /llegó a Mailpit/)
    } finally {
      await base.cerrar()
    }
  }
})

test('en local, un Mailpit que no responde no cuelga el guion: corta por tiempo y no da verde', async () => {
  const base = await levantar({
    respuestaFuncion: { cuerpo: { resultado: 'solicitud_enviada', nuevo: true, enviado: true } },
    mailpitColgado: true,
  })
  try {
    const inicio = Date.now()
    const r = await correr(entorno(base, { MAILPIT_URL: base.url, MAILPIT_TIMEOUT_MS: '100' }))
    assert.equal(r.codigo, 1)
    assert.match(r.error, /no apareció en Mailpit/)
    // 10 intentos de 100 ms más la espera de 500 ms entre ellos: bien por debajo de un cuelgue real.
    assert.ok(Date.now() - inicio < 20_000, 'el guion tardó demasiado: la consulta a Mailpit no tiene tope')
  } finally {
    // El servidor de prueba conserva las conexiones colgadas: se cierran para que `cerrar` no espere.
    base.cerrar()
  }
})
