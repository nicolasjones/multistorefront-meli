// Pruebas de `enviar-aviso-faltante` con la base y el SMTP simulados. Corre con `node --test`
// (`pnpm test:edge:enviar-aviso-faltante`); handler.ts y contenido.ts no importan nada de Deno.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { asuntoAviso, cuerpoAviso, MENSAJE_MAX, neutralizarPuntos, sanearMensaje } from './contenido.ts'
import { CORREO_VALIDO, MAX_INTENTOS, esErrorDeEsquemaFaltante, PRESUPUESTO_BARRIDO_MS, codigoDeError, manejar, type Deps, type Tomado } from './handler.ts'
import { lineaSegura } from '../_shared/texto.ts'
import { conTimeout } from '../_shared/timeout.ts'
import { enviarConLimites, sondearConexion, TIMEOUT_CIERRE_MS, TIMEOUT_CONEXION_MS, TIMEOUT_SMTP_MS } from '../_shared/envio.ts'
import { crearDatos } from './datos.ts'
import { armarDeps, armarDepsDesdeEntorno, opcionesClienteServicio } from './servidor.ts'
import { armarEnvio, armarEnvioDesdeEntorno } from '../_shared/smtp.ts'
import { CODIGOS_ERROR_BASE } from './codigos.ts'
import { readFileSync } from 'node:fs'

const ID = '11111111-1111-4111-8111-111111111111'
const TOKEN = 'secreto-de-prueba'

const TANDA = '33333333-3333-4333-8333-333333333333'

const aEnviar: Tomado = {
  tanda: TANDA,
  cliente: 'Ana Pérez',
  correo: 'ana@example.com',
  lineas: [
    { producto: 'Funda', sku: 'FUN-1', cantidad: 3, comprobante: 'A-0001' },
    { producto: 'Cable', sku: null, cantidad: 1, comprobante: 'A-0002' },
  ],
}

type Opciones = {
  tomado?: Tomado[]
  tomarError?: boolean
  falloSmtp?: string
  cerrarError?: boolean
  pendientes?: string[]
  pendientesError?: boolean
  token?: string | undefined
}

function montar(opciones: Opciones = {}) {
  const enviados: { para: string[]; asunto: string; texto: string }[] = []
  const cierres: { id: string; enviado: boolean; error: string | null; tope: number; tanda: string | null }[] = []
  const tomas: { id: string; tope: number }[] = []
  const deps: Deps = {
    token: 'token' in opciones ? opciones.token : TOKEN,
    datos: {
      pendientes: async () => opciones.pendientesError
        ? { data: null, error: { message: 'boom' } }
        : { data: opciones.pendientes ?? [], error: null },
      tomar: async (id, tope) => {
        tomas.push({ id, tope })
        return opciones.tomarError ? { data: null, error: { message: 'boom' } } : { data: opciones.tomado ?? [aEnviar], error: null }
      },
      cerrar: async (id, enviado, error, tope, tanda) => {
        cierres.push({ id, enviado, error, tope, tanda })
        return { data: null, error: opciones.cerrarError ? { message: 'boom' } : null }
      },
    },
    enviar: async (mensaje) => {
      if (opciones.falloSmtp) throw new Error(opciones.falloSmtp)
      enviados.push(mensaje)
    },
  }
  return { deps, enviados, cierres, tomas }
}

const pedir = (deps: Deps, body: unknown, token: string | null = TOKEN, method = 'POST') =>
  manejar(new Request('http://x/', {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { 'x-aviso-token': token } : {}) },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  }), deps)

describe('enviar-aviso-faltante · envío', () => {
  it('manda UN correo por cliente con todos sus faltantes y cierra como enviado', { timeout: 10_000 }, async () => {
    const { deps, enviados, cierres } = montar()
    const res = await pedir(deps, { cliente_id: ID })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { estado: 'enviado' })
    assert.equal(enviados.length, 1)
    assert.deepEqual(enviados[0].para, ['ana@example.com'])
    assert.equal(enviados[0].asunto, asuntoAviso())
    assert.match(enviados[0].texto, /Ana Pérez/)
    assert.match(enviados[0].texto, /Funda \(FUN-1\) · 3 u\. · Comprobante A-0001/)
    assert.match(enviados[0].texto, /Cable · 1 u\. · Comprobante A-0002/)
    assert.deepEqual(cierres, [{ id: ID, enviado: true, error: null, tope: MAX_INTENTOS, tanda: TANDA }])
  })

  it('el destinatario sale de la base, nunca del pedido', { timeout: 10_000 }, async () => {
    const { deps, enviados } = montar()
    await pedir(deps, { cliente_id: ID, para: 'atacante@evil.com', correo: 'atacante@evil.com' })
    assert.deepEqual(enviados[0].para, ['ana@example.com'])
  })

  it('un fallo de SMTP queda como fallido con un código genérico y no lanza', { timeout: 10_000 }, async () => {
    const { deps, cierres } = montar({ falloSmtp: 'connect ECONNREFUSED 127.0.0.1:1025' })
    const res = await pedir(deps, { cliente_id: ID })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { estado: 'fallido' })
    assert.deepEqual(cierres, [{ id: ID, enviado: false, error: 'smtp_conexion', tope: MAX_INTENTOS, tanda: TANDA }])
  })

  it('el cierre lleva el token de la tanda tomada (M-2)', { timeout: 10_000 }, async () => {
    const { deps, cierres } = montar()
    await pedir(deps, { cliente_id: ID })
    assert.equal(cierres[0].tanda, TANDA)
  })

  it('el error guardado es solo un código: nunca host, usuario ni correo (m-4b)', { timeout: 10_000 }, async () => {
    const casos: [string, string][] = [
      ['535 Authentication failed for user smtp-prod@mail.interno.net', 'smtp_auth'],
      ['550 5.1.1 <ana@example.com>: Recipient address rejected', 'destinatario_invalido'],
      ['getaddrinfo ENOTFOUND mail.interno.net', 'smtp_conexion'],
      [`algo raro\r\n${'x'.repeat(1000)}`, 'otro'],
    ]
    for (const [falla, codigo] of casos) {
      const { deps, cierres } = montar({ falloSmtp: falla })
      await pedir(deps, { cliente_id: ID })
      assert.equal(cierres[0].error, codigo, falla)
    }
  })

  it('pide a la base el tope de intentos, que es quien corta los reintentos', { timeout: 10_000 }, async () => {
    const { deps, tomas } = montar()
    await pedir(deps, { cliente_id: ID })
    assert.deepEqual(tomas, [{ id: ID, tope: MAX_INTENTOS }])
  })

  it('sin filas (reservado, ya enviado o sin nada vigente) no envía ni cierra', { timeout: 10_000 }, async () => {
    const { deps, enviados, cierres } = montar({ tomado: [] })
    assert.deepEqual(await (await pedir(deps, { cliente_id: ID })).json(), { estado: 'nada' })
    assert.equal(enviados.length + cierres.length, 0)
  })

  it('con un correo que no es una dirección cierra como fallido sin enviar', { timeout: 10_000 }, async () => {
    const { deps, enviados, cierres } = montar({ tomado: [{ ...aEnviar, correo: 'x@y.com\r\nBcc: z@w.com' }] })
    assert.deepEqual(await (await pedir(deps, { cliente_id: ID })).json(), { estado: 'fallido' })
    assert.equal(enviados.length, 0)
    assert.equal(cierres.length, 1)
    assert.equal(cierres[0].enviado, false)
    assert.equal(cierres[0].error, 'destinatario_invalido')
  })

  it('si la base no responde devuelve 502 sin enviar', { timeout: 10_000 }, async () => {
    const { deps, enviados } = montar({ tomarError: true })
    assert.equal((await pedir(deps, { cliente_id: ID })).status, 502)
    assert.equal(enviados.length, 0)
  })

  it('si el correo salió pero no se pudo cerrar, igual informa enviado (al menos una vez)', { timeout: 10_000 }, async () => {
    const { deps } = montar({ cerrarError: true })
    assert.deepEqual(await (await pedir(deps, { cliente_id: ID })).json(), { estado: 'enviado' })
  })
})

describe('enviar-aviso-faltante · contenido', () => {
  it('los datos del cliente y del producto no rompen líneas ni cabeceras', { timeout: 10_000 }, () => {
    const texto = cuerpoAviso('Ana\r\nBcc: x@y.com', [{ producto: 'Funda\nmala', sku: 'S\r\n1', cantidad: 2, comprobante: 'A\n1' }])
    assert.equal(texto.includes('\r'), false)
    assert.match(texto, /Hola Ana Bcc: x@y\.com,/)
    assert.match(texto, /- Funda mala \(S 1\) · 2 u\. · Comprobante A 1/)
    assert.equal(asuntoAviso().includes('\n'), false)
  })
})

describe('enviar-aviso-faltante · mensaje editable (F-VTA-26)', () => {
  const linea = { producto: 'Funda', sku: 'FUN-1', cantidad: 3, comprobante: 'A-0001' }

  it('con mensaje, reemplaza las frases fijas y conserva el saludo y la lista de productos', { timeout: 10_000 }, () => {
    const texto = cuerpoAviso('Ana', [{ ...linea, mensaje: 'Ya llegaron tus pedidos.\nPasá cuando quieras.' }])
    assert.equal(
      texto,
      ['Hola Ana,', '', 'Ya llegaron tus pedidos.\nPasá cuando quieras.', '', '- Funda (FUN-1) · 3 u. · Comprobante A-0001', ''].join('\n'),
    )
    assert.equal(texto.includes('Volvió a haber stock'), false)
    assert.equal(texto.includes('Escribinos para coordinar'), false)
  })

  it('sin mensaje (ausente, null o vacío) el correo es el de F-STK-17 sin cambios', { timeout: 10_000 }, () => {
    const previo = cuerpoAviso('Ana', [linea])
    assert.match(previo, /Volvió a haber stock de los productos que tenías pedidos:/)
    assert.match(previo, /Escribinos para coordinar la entrega\./)
    assert.equal(cuerpoAviso('Ana', [{ ...linea, mensaje: null }]), previo)
    assert.equal(cuerpoAviso('Ana', [{ ...linea, mensaje: '  \n\u0007 ' }]), previo)
  })

  it('sanea el mensaje: sin caracteres de control, sin saltos de más y con tope de 1.000', { timeout: 10_000 }, () => {
    assert.equal(sanearMensaje('Hola\u0000 \u0007mundo\u007F'), 'Hola mundo')
    assert.equal(sanearMensaje('a\r\nb\rc'), 'a\nb\nc')
    assert.equal(sanearMensaje('Hola\u200B \u202Emundo\uFEFF'), 'Hola mundo')
    assert.equal(sanearMensaje('a\n\n\n\n\nb'), 'a\n\nb')
    assert.equal(sanearMensaje('a\tb'), 'a b')
    assert.equal(sanearMensaje('x'.repeat(MENSAJE_MAX + 50))?.length, MENSAJE_MAX)
    assert.equal(sanearMensaje(undefined), null)
    assert.equal(sanearMensaje('   '), null)
  })

  it('el mensaje sigue siendo texto plano: no se interpreta HTML ni arma cabeceras', { timeout: 10_000 }, () => {
    const texto = cuerpoAviso('Ana', [{ ...linea, mensaje: 'Hola\r\nBcc: x@y.com\n<b>fuerte</b>' }])
    assert.equal(texto.includes('\r'), false)
    assert.match(texto, /<b>fuerte<\/b>/)
    assert.equal(asuntoAviso().includes('Bcc'), false)
  })

  it('el handler pasa el mensaje de la cola al correo', { timeout: 10_000 }, async () => {
    const { deps, enviados } = montar({ tomado: [{ ...aEnviar, lineas: [{ ...linea, mensaje: 'Texto editado' }] }] })
    const res = await pedir(deps, { cliente_id: ID })
    assert.deepEqual(await res.json(), { estado: 'enviado' })
    assert.match(enviados[0].texto, /Texto editado/)
    assert.equal(enviados[0].texto.includes('Volvió a haber stock'), false)
  })
})

describe('enviar-aviso-faltante · barrido', () => {
  it('procesa cada cliente pendiente y resume por estado', { timeout: 10_000 }, async () => {
    const otro = '22222222-2222-4222-8222-222222222222'
    const { deps, enviados } = montar({ pendientes: [ID, otro] })
    const res = await pedir(deps, { barrer: true })
    assert.deepEqual(await res.json(), { procesados: 2, resultados: { enviado: 2 }, errores: 0 })
    assert.equal(enviados.length, 2)
  })

  it('un cliente que falla no frena a los demás', { timeout: 10_000 }, async () => {
    let n = 0
    const { deps } = montar({ pendientes: [ID, '22222222-2222-4222-8222-222222222222'] })
    const tomar = deps.datos.tomar
    deps.datos.tomar = async (id, tope) => (n++ === 0 ? { data: null, error: { message: 'boom' } } : tomar(id, tope))
    assert.deepEqual(await (await pedir(deps, { barrer: true })).json(), { procesados: 2, resultados: { enviado: 1 }, errores: 1 })
  })

  it('sin pendientes no hace nada', { timeout: 10_000 }, async () => {
    const { deps, enviados } = montar({ pendientes: [] })
    assert.deepEqual(await (await pedir(deps, { barrer: true })).json(), { procesados: 0, resultados: {}, errores: 0 })
    assert.equal(enviados.length, 0)
  })

  it('si no puede listar los pendientes devuelve 502', { timeout: 10_000 }, async () => {
    assert.equal((await pedir(montar({ pendientesError: true }).deps, { barrer: true })).status, 502)
  })
})

describe('enviar-aviso-faltante · entrada', () => {
  it('rechaza sin token y con token incorrecto', { timeout: 10_000 }, async () => {
    const { deps, enviados, tomas } = montar()
    assert.equal((await pedir(deps, { cliente_id: ID }, null)).status, 403)
    assert.equal((await pedir(deps, { cliente_id: ID }, 'otro-secreto-')).status, 403)
    assert.equal((await pedir(deps, { cliente_id: ID }, 'x')).status, 403)
    assert.equal(enviados.length + tomas.length, 0)
  })

  it('sin AVISOS_FALTANTES_TOKEN configurado rechaza todo (503)', { timeout: 10_000 }, async () => {
    const { deps, tomas } = montar({ token: undefined })
    assert.equal((await pedir(deps, { cliente_id: ID }, '')).status, 503)
    assert.equal((await pedir(deps, { cliente_id: ID }, 'undefined')).status, 503)
    assert.equal(tomas.length, 0)
  })

  it('rechaza un cliente que no es un uuid y un cuerpo vacío', { timeout: 10_000 }, async () => {
    const { deps, tomas } = montar()
    assert.equal((await pedir(deps, { cliente_id: 'no-es-uuid' })).status, 400)
    assert.equal((await pedir(deps, {})).status, 400)
    assert.equal(tomas.length, 0)
  })

  it('solo acepta POST (y responde el preflight)', { timeout: 10_000 }, async () => {
    const { deps } = montar()
    assert.equal((await pedir(deps, undefined, TOKEN, 'GET')).status, 405)
    assert.equal((await pedir(deps, undefined, TOKEN, 'OPTIONS')).status, 200)
  })
})

describe('enviar-aviso-faltante · destinatario y saneo (m-3, m-4)', () => {
  it('el correo del destinatario es una sola dirección', { timeout: 10_000 }, () => {
    for (const bueno of ['ana@example.com', 'a.b+c@sub.example.com.ar']) assert.equal(CORREO_VALIDO.test(bueno), true, bueno)
    for (const malo of ['a@x.com\u0001z.w', 'a\u007F@x.com', 'a@x.com,b@y.com', 'a@x.com;b@y.com', 'Ana <a@x.com>', '"a"@x.com', 'a@x', 'a b@x.com', 'a@x.com\r\nBcc: z@w.com']) {
      assert.equal(CORREO_VALIDO.test(malo), false, malo)
    }
  })

  it('un destinatario con coma no se envía: cierra como fallido', { timeout: 10_000 }, async () => {
    const { deps, enviados, cierres } = montar({ tomado: [{ ...aEnviar, correo: 'a@x.com,b@y.com' }] })
    assert.deepEqual(await (await pedir(deps, { cliente_id: ID })).json(), { estado: 'fallido' })
    assert.equal(enviados.length, 0)
    assert.equal(cierres[0].error, 'destinatario_invalido')
  })

  it('lineaSegura quita saltos, U+2028/2029, controles e invisibles', { timeout: 10_000 }, () => {
    assert.equal(lineaSegura('a\r\nb\u2028c\u2029d\u0007e\u0085f\u202Eg\u200Bh'), 'a b c d e f g h')
    assert.equal(lineaSegura('  hola  '), 'hola')
  })

  it('codigoDeError clasifica sin devolver el texto del servidor', { timeout: 10_000 }, () => {
    assert.equal(codigoDeError(new DOMException('smtp timeout: x', 'TimeoutError')), 'smtp_timeout')
    assert.equal(codigoDeError(new Error('Connection refused')), 'smtp_conexion')
    assert.equal(codigoDeError('cualquier cosa'), 'otro')
  })
})

describe('enviar-aviso-faltante · dot-stuffing (m-5)', () => {
  it('ninguna línea del correo empieza con punto aunque el texto editado lo intente', { timeout: 10_000 }, () => {
    const texto = cuerpoAviso('Ana', [{ producto: 'Funda', sku: null, cantidad: 1, comprobante: 'A-1', mensaje: 'hola\n.\nMAIL FROM:<x>' }])
    assert.equal(texto.split('\n').some((linea) => linea.startsWith('.')), false)
    assert.equal(texto.split('\n').includes('.'), false)
    assert.match(texto, /MAIL FROM:<x>/)
    assert.equal(neutralizarPuntos('a\n.b\n..c'), 'a\n .b\n ..c')
  })
})

describe('_shared/timeout · tope del envío SMTP (M-2)', () => {
  it('corta un envío colgado con TimeoutError', { timeout: 10_000 }, async () => {
    const colgado = new Promise<void>(() => undefined)
    await assert.rejects(conTimeout(colgado, 20), (error: Error) => error.name === 'TimeoutError' && /smtp timeout/.test(error.message))
  })

  it('deja pasar el resultado y el error de un envío que responde a tiempo', { timeout: 10_000 }, async () => {
    assert.equal(await conTimeout(Promise.resolve('ok'), 1000), 'ok')
    await assert.rejects(conTimeout(Promise.reject(new Error('boom')), 1000), /boom/)
  })
})

describe('enviar-aviso-faltante · revisión PR #915', () => {
  it('lineaSegura no parte nombres con ZWNJ/ZWJ pero sigue quitando los invisibles de dirección', { timeout: 10_000 }, () => {
    assert.equal(lineaSegura('می\u200Cخواهم'), 'می\u200Cخواهم')
    assert.equal(lineaSegura('👨\u200D👩'), '👨\u200D👩')
    assert.equal(lineaSegura('a\u200Bb\u202Ec'), 'a b c')
  })

  it('sanearMensaje recorta igual que la base: solo espacio y salto de línea (no NBSP)', { timeout: 10_000 }, () => {
    assert.equal(sanearMensaje('\u00A0hola\u00A0'), '\u00A0hola\u00A0')
    assert.equal(sanearMensaje(' \n hola \n '), 'hola')
    assert.equal(sanearMensaje(`${'x'.repeat(MENSAJE_MAX - 1)} y`), 'x'.repeat(MENSAJE_MAX - 1))
  })

  it('un timeout de SMTP se informa como smtp_timeout (el cierre lo trata como intento incierto)', { timeout: 10_000 }, async () => {
    const { deps, cierres } = montar()
    deps.enviar = async () => { throw new DOMException('smtp timeout: el servidor no respondió a tiempo', 'TimeoutError') }
    await pedir(deps, { cliente_id: ID })
    assert.equal(cierres[0].error, 'smtp_timeout')
  })

  it('el barrido corta por reloj: no empieza otro cliente si gastó el presupuesto y dice cuántos quedan', { timeout: 10_000 }, async () => {
    const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333']
    const { deps, enviados } = montar({ pendientes: ids })
    let t = 0
    deps.ahora = () => t
    const enviar = deps.enviar
    deps.enviar = async (mensaje) => { t += PRESUPUESTO_BARRIDO_MS; await enviar(mensaje) }
    const res = await (await pedir(deps, { barrer: true })).json()
    assert.deepEqual(res, { procesados: 1, resultados: { enviado: 1 }, errores: 0, pendientes: 2 })
    assert.equal(enviados.length, 1)
  })
})

describe('_shared/envio · cableado del timeout y del cierre (revisión QA PR #915 m2)', () => {
  const nunca = () => new Promise<void>(() => undefined)

  it('un envío que no resuelve falla con TimeoutError y cierra el cliente', { timeout: 10_000 }, async () => {
    let cerrado = 0
    const cliente = { send: nunca, close: async () => { cerrado += 1 } }
    await assert.rejects(enviarConLimites(cliente, 'x', { timeoutMs: 20, cierreMs: 50 }), (e: Error) => e.name === 'TimeoutError')
    assert.equal(cerrado, 1)
  })

  it('el close() colgado no cuelga la respuesta ni cambia el resultado', { timeout: 10_000 }, async () => {
    const cliente = { send: async () => undefined, close: nunca }
    const inicio = Date.now()
    await enviarConLimites(cliente, 'x', { timeoutMs: 1000, cierreMs: 30 })
    assert.ok(Date.now() - inicio < 500)
  })

  it('un close() colgado tampoco tapa el timeout del envío', { timeout: 10_000 }, async () => {
    const cliente = { send: nunca, close: nunca }
    await assert.rejects(enviarConLimites(cliente, 'x', { timeoutMs: 20, cierreMs: 30 }), (e: Error) => e.name === 'TimeoutError')
  })

  it('el error del envío se propaga y un close() que falla se ignora', { timeout: 10_000 }, async () => {
    const cliente = { send: async () => { throw new Error('boom') }, close: async () => { throw new Error('cierre') } }
    await assert.rejects(enviarConLimites(cliente, 'x'), /boom/)
  })

  it('un timeout llega al handler como smtp_timeout (el envío colgado cierra el aviso como intento incierto)', { timeout: 10_000 }, async () => {
    const { deps, cierres } = montar()
    deps.enviar = (mensaje) => enviarConLimites({ send: nunca, close: async () => undefined }, mensaje, { timeoutMs: 20, cierreMs: 20 })
    await pedir(deps, { cliente_id: ID })
    assert.equal(cierres[0].error, 'smtp_timeout')
    assert.equal(cierres[0].tanda, TANDA)
  })

  it('con una base sin migrar (sin token de tanda) no envía: falla cerrado con 502', { timeout: 10_000 }, async () => {
    const { deps, enviados, cierres } = montar({ tomado: [{ ...aEnviar, tanda: undefined }] })
    assert.equal((await pedir(deps, { cliente_id: ID })).status, 502)
    assert.equal(enviados.length + cierres.length, 0)
  })
})

describe('paridad de saneo con private.sanear_mensaje_aviso (SQL, QA PR #915 m6)', () => {
  // Misma tabla en supabase/tests/database/faltantes_avisos_venta.test.sql: si se cambia una, se cambia la otra.
  const casos: [string, string | null][] = [
    ['Hola\u0007 mundo', 'Hola mundo'],
    ['a\u0001b\u001Fc\u007Fd\u009Fe', 'abcde'],
    ['x\u0085y', 'x\ny'],
    ['a\u200Bb\u200Cc\u200Dd\u200Ee\u200Ff', 'abcdef'],
    ['x\u202Ay\u202Bz\u202Cw\u202Dv\u202Eu', 'xyzwvu'],
    ['p\u2060q\u2061r\u2064s\u2066t\u2069u\uFEFFv', 'pqrstuv'],
    ['l1\u2028l2\u2029l3', 'l1\nl2\nl3'],
    ['a\r\nb\rc', 'a\nb\nc'],
    ['a\tb', 'a b'],
    ['a\n\n\n\n\nb', 'a\n\nb'],
    ['  \n hola \n  ', 'hola'],
    ['\u00A0hola\u00A0', '\u00A0hola\u00A0'],
    ['\u0007\u200B \n', null],
    ['', null],
  ]
  for (const [entrada, esperado] of casos) {
    it(`sanearMensaje(${JSON.stringify(entrada)}) = ${JSON.stringify(esperado)}`, { timeout: 10_000 }, () => {
      assert.equal(sanearMensaje(entrada), esperado)
    })
  }
})

describe('enviar-aviso-faltante · revisión PR #918', () => {
  it('un timeout de CONEXIÓN no es incierto (no salió nada: smtp_conexion, reintentable); solo el corte propio lo es', { timeout: 10_000 }, () => {
    assert.equal(codigoDeError(new Error('connection timed out (ETIMEDOUT) connecting to smtp:587')), 'smtp_conexion')
    assert.equal(codigoDeError(new Error('Operation timed out (os error 110)')), 'smtp_conexion')
    assert.equal(codigoDeError(new DOMException('smtp timeout: el servidor no respondió a tiempo', 'TimeoutError')), 'smtp_timeout')
  })

  it('clasifica los rechazos del SMTP sin confundirlos', { timeout: 10_000 }, () => {
    assert.equal(codigoDeError(new Error('554 Message rejected: spam')), 'otro')
    assert.equal(codigoDeError(new Error('550 Relaying denied, not authorized')), 'otro')
    assert.equal(codigoDeError(new Error('550 5.1.1 Recipient address rejected: User unknown')), 'destinatario_invalido')
    assert.equal(codigoDeError(new Error('535 5.7.8 Authentication failed')), 'smtp_auth')
    assert.equal(codigoDeError(new Error('530 Authentication required')), 'smtp_auth')
  })

  it('CORREO_VALIDO rechaza los invisibles y bidi que lineaSegura convertiría en espacio', { timeout: 10_000 }, () => {
    for (const c of ['​', '‎', '‏', '‪', '‮', '⁠', '⁤', '⁦', '⁩', ' ', '﻿']) {
      assert.equal(CORREO_VALIDO.test(`a@x${c}e.com`), false, JSON.stringify(c))
    }
    assert.equal(CORREO_VALIDO.test('ana@example.com'), true)
  })

  it('sin la migración la sonda corta antes de tomar: 503, no se gastan intentos ni se envía (barrido e individual)', { timeout: 10_000 }, async () => {
    for (const cuerpo of [{ barrer: true }, { cliente_id: ID }]) {
      const { deps, enviados, tomas, cierres } = montar({ pendientes: [ID] })
      deps.sonda = async () => ({ data: null, error: { message: 'function cerrar_aviso_faltante(...) does not exist' } })
      const res = await pedir(deps, cuerpo)
      assert.equal(res.status, 503)
      assert.match((await res.json()).error, /migración/)
      assert.equal(enviados.length + tomas.length + cierres.length, 0)
    }
  })

  it('con la migración la sonda pasa y el aviso sigue su curso', { timeout: 10_000 }, async () => {
    const { deps, enviados } = montar()
    deps.sonda = async () => ({ data: null, error: null })
    assert.deepEqual(await (await pedir(deps, { cliente_id: ID })).json(), { estado: 'enviado' })
    assert.equal(enviados.length, 1)
  })

  it('un barrido donde TODOS fallan devuelve 502 (Kestra ve el error); si alguno sale, 200', { timeout: 10_000 }, async () => {
    const { deps } = montar({ pendientes: [ID], tomado: [{ ...aEnviar, tanda: undefined }] })
    const res = await pedir(deps, { barrer: true })
    assert.equal(res.status, 502)
    assert.equal((await res.json()).errores, 1)
    const otro = '22222222-2222-4222-8222-222222222222'
    const mixto = montar({ pendientes: [ID, otro] })
    let n = 0
    const tomar = mixto.deps.datos.tomar
    mixto.deps.datos.tomar = async (id, tope) => (n++ === 0 ? { data: null, error: { message: 'boom' } } : tomar(id, tope))
    assert.equal((await pedir(mixto.deps, { barrer: true })).status, 200)
  })

  it('los tiempos caben bajo el límite de la función (150 s) y bajo la reserva de la cola (2 min)', { timeout: 10_000 }, () => {
    assert.ok(TIMEOUT_CONEXION_MS + TIMEOUT_SMTP_MS + TIMEOUT_CIERRE_MS < 120_000, 'conexión + envío + cierre tienen que terminar antes de que venza la reserva de 2 minutos')
    assert.ok(PRESUPUESTO_BARRIDO_MS + TIMEOUT_CONEXION_MS + TIMEOUT_SMTP_MS + TIMEOUT_CIERRE_MS + 10_000 <= 150_000, 'el peor caso de un barrido (cliente iniciado justo antes del corte) entra en el límite')
  })

  it('el adaptador pasa la tanda a cerrar y a la sonda (cableado de index.ts)', { timeout: 10_000 }, async () => {
    const llamadas: { nombre: string; args: Record<string, unknown> }[] = []
    const { datos, sonda } = crearDatos({ rpc: async (nombre, args) => { llamadas.push({ nombre, args }); return { data: null, error: null } } })
    await datos.cerrar(ID, true, null, 5, TANDA)
    await datos.tomar(ID, 5)
    await datos.pendientes(5, 50)
    await sonda()
    assert.deepEqual(llamadas[0], { nombre: 'cerrar_aviso_faltante', args: { p_cliente: ID, p_enviado: true, p_error: null, p_tope: 5, p_tanda: TANDA } })
    assert.deepEqual(llamadas.slice(1, 3).map((l) => l.nombre), ['tomar_aviso_faltante', 'faltantes_avisos_pendientes'])
    assert.equal(llamadas[3].nombre, 'cerrar_aviso_faltante')
    assert.ok('p_tanda' in llamadas[3].args)
  })

  it('el recorte a 1.000 es por caracteres y no deja un par sustituto suelto (como left() de la base)', { timeout: 10_000 }, () => {
    const texto = sanearMensaje('x'.repeat(MENSAJE_MAX - 1) + '😀😀')
    assert.equal(Array.from(texto ?? '').length, MENSAJE_MAX)
    assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(texto ?? ''), false)
  })
})

describe('enviar-aviso-faltante · revisión PR #920', () => {
  it('clasifica por código numérico del servidor, no por un número suelto', { timeout: 10_000 }, () => {
    const casos: [string, string][] = [
      ['535 5.7.8 Authentication failed', 'smtp_auth'],
      ['530 5.7.0 Authentication required', 'smtp_auth'],
      ['bad response on command port 535', 'otro'],
      ['connection refused on port 535', 'smtp_conexion'],
      ['550 5.7.1 Relaying denied', 'otro'],
      ['550 5.1.1 Recipient address rejected: User unknown', 'destinatario_invalido'],
      ['Bad response: 550 5.1.1 User unknown', 'destinatario_invalido'],
      ['450 4.2.0 Mailbox busy, try later', 'otro'],
      ['554 5.7.1 Message rejected: spam', 'otro'],
      ['552 5.3.4 Message size exceeds limit', 'otro'],
      ['421 4.4.2 timeout waiting for client input', 'otro'],
    ]
    for (const [texto, esperado] of casos) assert.equal(codigoDeError(new Error(texto)), esperado, texto)
  })

  it('separa la fase de conexión del envío: conexión vencida = smtp_conexion (no salió nada); envío vencido = smtp_timeout', { timeout: 10_000 }, async () => {
    const nunca = () => new Promise<void>(() => undefined)
    let enviado = 0
    const cliente = { send: async () => { enviado += 1 }, close: async () => undefined }
    const falla = await enviarConLimites(cliente, 'x', { conectar: nunca, conexionMs: 20, cierreMs: 20 }).catch((e: Error) => e)
    assert.ok(falla instanceof Error)
    assert.equal(codigoDeError(falla), 'smtp_conexion')
    assert.equal(enviado, 0)

    const colgado = { send: nunca, close: async () => undefined }
    const falla2 = await enviarConLimites(colgado, 'x', { conectar: async () => undefined, conexionMs: 50, timeoutMs: 20, cierreMs: 20 }).catch((e: Error) => e)
    assert.equal(codigoDeError(falla2), 'smtp_timeout')
  })

  it('una conexión vencida llega al handler como smtp_conexion (el aviso sigue reintentable)', { timeout: 10_000 }, async () => {
    const { deps, cierres } = montar()
    deps.enviar = (mensaje) => enviarConLimites({ send: async () => undefined, close: async () => undefined }, mensaje, { conectar: () => new Promise(() => undefined), conexionMs: 20, cierreMs: 20 })
    await pedir(deps, { cliente_id: ID })
    assert.equal(cierres[0].error, 'smtp_conexion')
  })
})

describe('enviar-aviso-faltante · cableado y diagnóstico (QA PR #920)', () => {
  it('la sonda distingue «base no migrada» (503) de una caída o falta de permisos (502, sin decir «no migrada»)', { timeout: 10_000 }, async () => {
    const casos: [{ message: string; code?: string }, number, string][] = [
      [{ message: 'Could not find the function public.cerrar_aviso_faltante(p_tanda) in the schema cache', code: 'PGRST202' }, 503, 'base_no_migrada'],
      [{ message: 'function public.cerrar_aviso_faltante(uuid, boolean, text, integer, uuid) does not exist', code: '42883' }, 503, 'base_no_migrada'],
      [{ message: 'FetchError: connect ECONNREFUSED 10.0.0.5:54321 (host interno)' }, 502, 'base_no_disponible'],
      [{ message: 'permission denied for function cerrar_aviso_faltante', code: '42501' }, 502, 'base_no_disponible'],
      [{ message: 'JWT expired', code: 'PGRST301' }, 502, 'base_no_disponible'],
    ]
    for (const [error, estado, codigo] of casos) {
      const { deps, tomas } = montar({ pendientes: [ID] })
      deps.sonda = async () => ({ data: null, error })
      const res = await pedir(deps, { barrer: true })
      const cuerpo = await res.json()
      assert.equal(res.status, estado, error.message)
      assert.equal(cuerpo.codigo, codigo)
      assert.equal(JSON.stringify(cuerpo).includes('10.0.0.5'), false, 'la respuesta no filtra el detalle')
      if (estado === 502) assert.doesNotMatch(cuerpo.error, /migra/i)
      assert.equal(tomas.length, 0)
    }
    assert.equal(esErrorDeEsquemaFaltante({ message: 'x', code: '42703' }), true)
    assert.equal(esErrorDeEsquemaFaltante({ message: 'timeout' }), false)
  })

  it('armarDeps cablea la sonda (sin ella una base sin migrar gastaría intentos): el cableado real de index.ts', { timeout: 10_000 }, async () => {
    const llamadas: string[] = []
    const deps = armarDeps({
      cliente: { rpc: async (nombre) => { llamadas.push(nombre); return { data: null, error: null } } },
      token: TOKEN,
      enviar: async () => undefined,
    })
    assert.equal(typeof deps.sonda, 'function')
    assert.equal(deps.token, TOKEN)
    await deps.sonda?.()
    assert.deepEqual(llamadas, ['cerrar_aviso_faltante'])
    // Y el handler la usa antes de tomar: con una sonda que falla, `tomar` no se llama.
    const dep2 = armarDeps({
      cliente: { rpc: async (nombre) => { llamadas.push(nombre); return { data: null, error: { message: 'does not exist', code: '42883' } } } },
      token: TOKEN,
      enviar: async () => undefined,
    })
    llamadas.length = 0
    const res = await pedir(dep2, { barrer: true })
    assert.equal(res.status, 503)
    assert.deepEqual(llamadas, ['cerrar_aviso_faltante'])
  })

  it('el envío SMTP pasa SIEMPRE por enviarConLimites: un send colgado vence por timeout y la conexión se sondea antes', { timeout: 10_000 }, async () => {
    const nunca = () => new Promise<void>(() => undefined)
    const eventos: string[] = []
    const envio = armarEnvio({
      config: { hostname: 'smtp.interno', from: 'avisos@x.com', port: 587, tls: false },
      crearCliente: () => ({ send: () => { eventos.push('send'); return nunca() }, close: async () => { eventos.push('close') } }),
      conectar: async (host, port) => { eventos.push(`conectar:${host}:${port}`) },
      limites: { timeoutMs: 20, cierreMs: 20, conexionMs: 50 },
    })
    const falla = await envio({ para: ['a@x.com'], asunto: 'Hola\r\nBcc: z@w.com', texto: 'hola' }).catch((e: Error) => e)
    assert.ok(falla instanceof Error)
    assert.equal(codigoDeError(falla), 'smtp_timeout')
    assert.deepEqual(eventos, ['conectar:smtp.interno:587', 'send', 'close'])
  })

  it('el envío arma el mensaje saneado y, si no se puede conectar, no llama a send', { timeout: 10_000 }, async () => {
    const enviados: unknown[] = []
    const ok = armarEnvio({
      config: { hostname: 'h', from: 'avisos@x.com', port: 25, tls: false },
      crearCliente: () => ({ send: async (m) => { enviados.push(m) }, close: async () => undefined }),
      conectar: async () => undefined,
    })
    await ok({ para: ['a@x.com'], asunto: 'Hola\r\nBcc: z@w.com', texto: 'cuerpo' })
    assert.deepEqual(enviados, [{ from: 'avisos@x.com', to: ['a@x.com'], subject: 'Hola Bcc: z@w.com', content: 'cuerpo' }])

    let send = 0
    const sinRed = armarEnvio({
      config: { hostname: 'h', from: 'avisos@x.com', port: 25, tls: false },
      crearCliente: () => ({ send: async () => { send += 1 }, close: async () => undefined }),
      conectar: async () => { throw new Error('connect ECONNREFUSED') },
    })
    const e = await sinRed({ para: ['a@x.com'], asunto: 'a', texto: 'b' }).catch((x: Error) => x)
    assert.equal(codigoDeError(e), 'smtp_conexion')
    assert.equal(send, 0)
  })

  it('la lista de códigos de ultimo_error de la función es EXACTAMENTE la del check de la migración', { timeout: 10_000 }, () => {
    const sql = readFileSync(new URL('../../migrations/20270306120000_faltantes_avisos_hallazgos_revision.sql', import.meta.url), 'utf8')
    const bloque = /ultimo_error is null or ultimo_error in \(([^)]*)\)/.exec(sql)?.[1] ?? ''
    const enSql = [...bloque.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
    assert.deepEqual(enSql, [...CODIGOS_ERROR_BASE].sort())
    // `cerrar_aviso_faltante` acepta los mismos (salvo `otro`, el valor por defecto de lo desconocido).
    const cerrar = readFileSync(new URL('../../migrations/20270306130000_faltantes_avisos_revision_pr915.sql', import.meta.url), 'utf8')
    const enCerrar = [...(/when p_error in \(([^)]*)\)/.exec(cerrar)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
    assert.deepEqual(enCerrar, CODIGOS_ERROR_BASE.filter((c) => c !== 'otro').sort())
  })
})

describe('enviar-aviso-faltante · seguimiento del PR #922', () => {
  it('no etiqueta como destinatario_invalido lo que es del remitente, de cuota o de volumen (m-1)', { timeout: 10_000 }, () => {
    const casos: [string, string][] = [
      ['553 5.7.1 Sender address rejected: not owned by user', 'otro'],
      ['550 5.1.8 Bad sender address syntax', 'otro'],
      ['552 5.2.2 Mailbox full', 'otro'],
      ['552 5.2.2 Over quota', 'otro'],
      ['550 5.5.3 Too many recipients', 'otro'],
      ['550 5.5.3 recipient list too large', 'otro'],
      ['550 5.1.1 Recipient address rejected: User unknown in virtual mailbox table', 'destinatario_invalido'],
      ['550 5.1.1 Mailbox unavailable', 'destinatario_invalido'],
      ['553 5.1.3 Invalid address syntax for recipient', 'destinatario_invalido'],
    ]
    for (const [texto, esperado] of casos) assert.equal(codigoDeError(new Error(texto)), esperado, texto)
  })

  it('la autenticación o el STARTTLS exigidos por el servidor son smtp_auth, también en un 5xx (m-2)', { timeout: 10_000 }, () => {
    assert.equal(codigoDeError(new Error('550 5.7.26 Authentication required')), 'smtp_auth')
    assert.equal(codigoDeError(new Error('530 5.7.0 Must issue a STARTTLS command first')), 'smtp_auth')
    assert.equal(codigoDeError(new Error('530 5.7.0 Authentication required')), 'smtp_auth')
    assert.equal(codigoDeError(new Error('535 5.7.8 Authentication credentials invalid')), 'smtp_auth')
  })

  it('el sondeo TCP se puede apagar (SMTP_SONDEO=false): no se conecta aparte y el envío sigue por enviarConLimites (m-3)', { timeout: 10_000 }, async () => {
    const eventos: string[] = []
    const base = {
      crearCliente: () => ({ send: async () => { eventos.push('send') }, close: async () => { eventos.push('close') } }),
      conectar: async () => { eventos.push('conectar') },
    }
    const config = { hostname: 'h', from: 'a@x.com', port: 25, tls: false }
    await armarEnvio({ ...base, config })({ para: ['a@x.com'], asunto: 'a', texto: 'b' })
    assert.deepEqual(eventos, ['conectar', 'send', 'close'], 'por defecto el sondeo está activo')
    eventos.length = 0
    await armarEnvio({ ...base, config: { ...config, sondeo: false } })({ para: ['a@x.com'], asunto: 'a', texto: 'b' })
    assert.deepEqual(eventos, ['send', 'close'], 'sin sondeo no hay conexión aparte')
    // Sin sondeo un send colgado sigue venciendo por timeout (smtp_timeout incierto).
    const colgado = armarEnvio({
      config: { ...config, sondeo: false },
      crearCliente: () => ({ send: () => new Promise<void>(() => undefined), close: async () => undefined }),
      conectar: async () => undefined,
      limites: { timeoutMs: 20, cierreMs: 20 },
    })
    const falla = await colgado({ para: ['a@x.com'], asunto: 'a', texto: 'b' }).catch((e: Error) => e)
    assert.equal(codigoDeError(falla), 'smtp_timeout')
  })

  it('el presupuesto del barrido (60 s) encaja con el peor caso por cliente, con y sin sondeo (m-3)', { timeout: 10_000 }, () => {
    const conSondeo = TIMEOUT_CONEXION_MS + TIMEOUT_SMTP_MS + TIMEOUT_CIERRE_MS // 45 s
    const sinSondeo = TIMEOUT_SMTP_MS + TIMEOUT_CIERRE_MS // 35 s
    assert.equal(conSondeo, 45_000)
    assert.ok(sinSondeo < conSondeo)
    // Un cliente que arranca justo antes del corte termina en presupuesto + peor caso (+ margen de RPC), bajo los 150 s de la función.
    assert.ok(PRESUPUESTO_BARRIDO_MS + conSondeo + 10_000 <= 150_000)
  })
})

describe('enviar-aviso-faltante · seguimiento QA PR #922 (R2, R3)', () => {
  const nunca = () => new Promise<never>(() => undefined)

  it('R2: un connect que llega DESPUÉS del timeout se cierra (no queda un socket abierto)', { timeout: 10_000 }, async () => {
    let cerrados = 0
    let resolver: (c: { close(): void }) => void = () => undefined
    const abrir = () => new Promise<{ close(): void }>((r) => { resolver = r })
    const cliente = { send: async () => undefined, close: async () => undefined }
    const falla = await enviarConLimites(cliente, 'x', {
      conectar: (senal) => sondearConexion(abrir, senal),
      conexionMs: 20,
      cierreMs: 20,
    }).catch((e: Error) => e)
    assert.equal(codigoDeError(falla), 'smtp_conexion')
    assert.equal(cerrados, 0)
    resolver({ close: () => { cerrados += 1 } })
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(cerrados, 1, 'el socket que conectó tarde se cierra al llegar')
  })

  it('R2: un connect que nunca resuelve no cuelga el envío; y uno que resuelve a tiempo se cierra en el acto', { timeout: 10_000 }, async () => {
    const cliente = { send: async () => undefined, close: async () => undefined }
    const falla = await enviarConLimites(cliente, 'x', { conectar: (senal) => sondearConexion(nunca, senal), conexionMs: 20, cierreMs: 20 }).catch((e: Error) => e)
    assert.equal(codigoDeError(falla), 'smtp_conexion')
    let cerrados = 0
    await enviarConLimites(cliente, 'x', { conectar: (senal) => sondearConexion(async () => ({ close: () => { cerrados += 1 } }), senal), conexionMs: 1000 })
    assert.equal(cerrados, 1)
  })

  const ENV = { SMTP_HOST: 'smtp.interno', SMTP_FROM: 'avisos@x.com', SMTP_PORT: '2525', SMTP_TLS: 'true', SMTP_USER: 'u', SMTP_PASS: 'p' }
  const montarEnvio = (variables: Record<string, string | undefined>) => {
    const registro = { cliente: [] as unknown[], conexion: [] as unknown[], enviados: [] as unknown[] }
    const envio = armarEnvioDesdeEntorno({
      env: (k) => variables[k],
      crearCliente: (opciones) => { registro.cliente.push(opciones); return { send: async (m) => { registro.enviados.push(m) }, close: async () => undefined } },
      abrirConexion: async (opciones) => { registro.conexion.push(opciones); return { close: () => undefined } },
    })
    return { envio, registro }
  }

  it('R3: el entorno llega al cliente y al sondeo con host y puerto EN SU LUGAR (no intercambiados)', { timeout: 10_000 }, async () => {
    const { envio, registro } = montarEnvio(ENV)
    await envio({ para: ['a@x.com'], asunto: 'a', texto: 'b' })
    assert.deepEqual(registro.cliente, [{ connection: { hostname: 'smtp.interno', port: 2525, tls: true, auth: { username: 'u', password: 'p' } } }])
    assert.deepEqual(registro.conexion, [{ hostname: 'smtp.interno', port: 2525 }])
    assert.equal(typeof (registro.conexion[0] as { port: unknown }).port, 'number')
    assert.deepEqual(registro.enviados, [{ from: 'avisos@x.com', to: ['a@x.com'], subject: 'a', content: 'b' }])
  })

  it('R3: sin credenciales no hay auth; con SMTP_SONDEO=false no se sondea; sin SMTP_HOST/FROM falla claro', { timeout: 10_000 }, async () => {
    const sinAuth = montarEnvio({ SMTP_HOST: 'h', SMTP_FROM: 'f@x.com' })
    await sinAuth.envio({ para: ['a@x.com'], asunto: 'a', texto: 'b' })
    assert.deepEqual(sinAuth.registro.cliente, [{ connection: { hostname: 'h', port: 587, tls: false } }])
    const sinSondeo = montarEnvio({ ...ENV, SMTP_SONDEO: 'false' })
    await sinSondeo.envio({ para: ['a@x.com'], asunto: 'a', texto: 'b' })
    assert.deepEqual(sinSondeo.registro.conexion, [])
    assert.equal(sinSondeo.registro.enviados.length, 1)
    const incompleto = montarEnvio({ SMTP_HOST: 'h' })
    await assert.rejects(incompleto.envio({ para: ['a@x.com'], asunto: 'a', texto: 'b' }), /Falta configurar SMTP_HOST/)
  })

  it('R3: index.ts cablea el cliente de servicio (URL y clave en su lugar) y el token de AVISOS_FALTANTES_TOKEN con la sonda', { timeout: 10_000 }, async () => {
    const env = (k: string) => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'clave-servicio', AVISOS_FALTANTES_TOKEN: 'tok' } as Record<string, string>)[k]
    const [url, clave, opciones] = opcionesClienteServicio(env)
    assert.equal(url, 'https://x.supabase.co')
    assert.equal(clave, 'clave-servicio')
    assert.deepEqual(opciones, { auth: { autoRefreshToken: false, persistSession: false } })
    const deps = armarDepsDesdeEntorno({ env, cliente: { rpc: async () => ({ data: null, error: null }) }, enviar: async () => undefined })
    assert.equal(deps.token, 'tok')
    assert.equal(typeof deps.sonda, 'function')
  })
})
