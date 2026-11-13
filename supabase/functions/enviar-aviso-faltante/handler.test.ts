// Pruebas de `enviar-aviso-faltante` con la base y el SMTP simulados. Corre con `node --test`
// (`pnpm test:edge:enviar-aviso-faltante`); handler.ts y contenido.ts no importan nada de Deno.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { asuntoAviso, cuerpoAviso, MENSAJE_MAX, neutralizarPuntos, sanearMensaje } from './contenido.ts'
import { CORREO_VALIDO, MAX_INTENTOS, codigoDeError, manejar, type Deps, type Tomado } from './handler.ts'
import { lineaSegura } from '../_shared/texto.ts'
import { conTimeout } from '../_shared/timeout.ts'

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
  it('manda UN correo por cliente con todos sus faltantes y cierra como enviado', async () => {
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

  it('el destinatario sale de la base, nunca del pedido', async () => {
    const { deps, enviados } = montar()
    await pedir(deps, { cliente_id: ID, para: 'atacante@evil.com', correo: 'atacante@evil.com' })
    assert.deepEqual(enviados[0].para, ['ana@example.com'])
  })

  it('un fallo de SMTP queda como fallido con un código genérico y no lanza', async () => {
    const { deps, cierres } = montar({ falloSmtp: 'connect ECONNREFUSED 127.0.0.1:1025' })
    const res = await pedir(deps, { cliente_id: ID })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { estado: 'fallido' })
    assert.deepEqual(cierres, [{ id: ID, enviado: false, error: 'smtp_conexion', tope: MAX_INTENTOS, tanda: TANDA }])
  })

  it('el cierre lleva el token de la tanda tomada (M-2)', async () => {
    const { deps, cierres } = montar()
    await pedir(deps, { cliente_id: ID })
    assert.equal(cierres[0].tanda, TANDA)
  })

  it('el error guardado es solo un código: nunca host, usuario ni correo (m-4b)', async () => {
    const casos: [string, string][] = [
      ['535 Authentication failed for user smtp-prod@mail.interno.net', 'smtp_auth'],
      ['550 5.1.1 <ana@example.com>: Recipient address rejected', 'destinatario_invalido'],
      ['smtp timeout: el servidor no respondió a tiempo', 'smtp_timeout'],
      ['getaddrinfo ENOTFOUND mail.interno.net', 'smtp_conexion'],
      [`algo raro\r\n${'x'.repeat(1000)}`, 'otro'],
    ]
    for (const [falla, codigo] of casos) {
      const { deps, cierres } = montar({ falloSmtp: falla })
      await pedir(deps, { cliente_id: ID })
      assert.equal(cierres[0].error, codigo, falla)
    }
  })

  it('pide a la base el tope de intentos, que es quien corta los reintentos', async () => {
    const { deps, tomas } = montar()
    await pedir(deps, { cliente_id: ID })
    assert.deepEqual(tomas, [{ id: ID, tope: MAX_INTENTOS }])
  })

  it('sin filas (reservado, ya enviado o sin nada vigente) no envía ni cierra', async () => {
    const { deps, enviados, cierres } = montar({ tomado: [] })
    assert.deepEqual(await (await pedir(deps, { cliente_id: ID })).json(), { estado: 'nada' })
    assert.equal(enviados.length + cierres.length, 0)
  })

  it('con un correo que no es una dirección cierra como fallido sin enviar', async () => {
    const { deps, enviados, cierres } = montar({ tomado: [{ ...aEnviar, correo: 'x@y.com\r\nBcc: z@w.com' }] })
    assert.deepEqual(await (await pedir(deps, { cliente_id: ID })).json(), { estado: 'fallido' })
    assert.equal(enviados.length, 0)
    assert.equal(cierres.length, 1)
    assert.equal(cierres[0].enviado, false)
    assert.equal(cierres[0].error, 'destinatario_invalido')
  })

  it('si la base no responde devuelve 502 sin enviar', async () => {
    const { deps, enviados } = montar({ tomarError: true })
    assert.equal((await pedir(deps, { cliente_id: ID })).status, 502)
    assert.equal(enviados.length, 0)
  })

  it('si el correo salió pero no se pudo cerrar, igual informa enviado (al menos una vez)', async () => {
    const { deps } = montar({ cerrarError: true })
    assert.deepEqual(await (await pedir(deps, { cliente_id: ID })).json(), { estado: 'enviado' })
  })
})

describe('enviar-aviso-faltante · contenido', () => {
  it('los datos del cliente y del producto no rompen líneas ni cabeceras', () => {
    const texto = cuerpoAviso('Ana\r\nBcc: x@y.com', [{ producto: 'Funda\nmala', sku: 'S\r\n1', cantidad: 2, comprobante: 'A\n1' }])
    assert.equal(texto.includes('\r'), false)
    assert.match(texto, /Hola Ana Bcc: x@y\.com,/)
    assert.match(texto, /- Funda mala \(S 1\) · 2 u\. · Comprobante A 1/)
    assert.equal(asuntoAviso().includes('\n'), false)
  })
})

describe('enviar-aviso-faltante · mensaje editable (F-VTA-26)', () => {
  const linea = { producto: 'Funda', sku: 'FUN-1', cantidad: 3, comprobante: 'A-0001' }

  it('con mensaje, reemplaza las frases fijas y conserva el saludo y la lista de productos', () => {
    const texto = cuerpoAviso('Ana', [{ ...linea, mensaje: 'Ya llegaron tus pedidos.\nPasá cuando quieras.' }])
    assert.equal(
      texto,
      ['Hola Ana,', '', 'Ya llegaron tus pedidos.\nPasá cuando quieras.', '', '- Funda (FUN-1) · 3 u. · Comprobante A-0001', ''].join('\n'),
    )
    assert.equal(texto.includes('Volvió a haber stock'), false)
    assert.equal(texto.includes('Escribinos para coordinar'), false)
  })

  it('sin mensaje (ausente, null o vacío) el correo es el de F-STK-17 sin cambios', () => {
    const previo = cuerpoAviso('Ana', [linea])
    assert.match(previo, /Volvió a haber stock de los productos que tenías pedidos:/)
    assert.match(previo, /Escribinos para coordinar la entrega\./)
    assert.equal(cuerpoAviso('Ana', [{ ...linea, mensaje: null }]), previo)
    assert.equal(cuerpoAviso('Ana', [{ ...linea, mensaje: '  \n\u0007 ' }]), previo)
  })

  it('sanea el mensaje: sin caracteres de control, sin saltos de más y con tope de 1.000', () => {
    assert.equal(sanearMensaje('Hola\u0000 \u0007mundo\u007F'), 'Hola mundo')
    assert.equal(sanearMensaje('a\r\nb\rc'), 'a\nb\nc')
    assert.equal(sanearMensaje('Hola\u200B \u202Emundo\uFEFF'), 'Hola mundo')
    assert.equal(sanearMensaje('a\n\n\n\n\nb'), 'a\n\nb')
    assert.equal(sanearMensaje('a\tb'), 'a b')
    assert.equal(sanearMensaje('x'.repeat(MENSAJE_MAX + 50))?.length, MENSAJE_MAX)
    assert.equal(sanearMensaje(undefined), null)
    assert.equal(sanearMensaje('   '), null)
  })

  it('el mensaje sigue siendo texto plano: no se interpreta HTML ni arma cabeceras', () => {
    const texto = cuerpoAviso('Ana', [{ ...linea, mensaje: 'Hola\r\nBcc: x@y.com\n<b>fuerte</b>' }])
    assert.equal(texto.includes('\r'), false)
    assert.match(texto, /<b>fuerte<\/b>/)
    assert.equal(asuntoAviso().includes('Bcc'), false)
  })

  it('el handler pasa el mensaje de la cola al correo', async () => {
    const { deps, enviados } = montar({ tomado: [{ ...aEnviar, lineas: [{ ...linea, mensaje: 'Texto editado' }] }] })
    const res = await pedir(deps, { cliente_id: ID })
    assert.deepEqual(await res.json(), { estado: 'enviado' })
    assert.match(enviados[0].texto, /Texto editado/)
    assert.equal(enviados[0].texto.includes('Volvió a haber stock'), false)
  })
})

describe('enviar-aviso-faltante · barrido', () => {
  it('procesa cada cliente pendiente y resume por estado', async () => {
    const otro = '22222222-2222-4222-8222-222222222222'
    const { deps, enviados } = montar({ pendientes: [ID, otro] })
    const res = await pedir(deps, { barrer: true })
    assert.deepEqual(await res.json(), { procesados: 2, resultados: { enviado: 2 }, errores: 0 })
    assert.equal(enviados.length, 2)
  })

  it('un cliente que falla no frena a los demás', async () => {
    let n = 0
    const { deps } = montar({ pendientes: [ID, '22222222-2222-4222-8222-222222222222'] })
    const tomar = deps.datos.tomar
    deps.datos.tomar = async (id, tope) => (n++ === 0 ? { data: null, error: { message: 'boom' } } : tomar(id, tope))
    assert.deepEqual(await (await pedir(deps, { barrer: true })).json(), { procesados: 2, resultados: { enviado: 1 }, errores: 1 })
  })

  it('sin pendientes no hace nada', async () => {
    const { deps, enviados } = montar({ pendientes: [] })
    assert.deepEqual(await (await pedir(deps, { barrer: true })).json(), { procesados: 0, resultados: {}, errores: 0 })
    assert.equal(enviados.length, 0)
  })

  it('si no puede listar los pendientes devuelve 502', async () => {
    assert.equal((await pedir(montar({ pendientesError: true }).deps, { barrer: true })).status, 502)
  })
})

describe('enviar-aviso-faltante · entrada', () => {
  it('rechaza sin token y con token incorrecto', async () => {
    const { deps, enviados, tomas } = montar()
    assert.equal((await pedir(deps, { cliente_id: ID }, null)).status, 403)
    assert.equal((await pedir(deps, { cliente_id: ID }, 'otro-secreto-')).status, 403)
    assert.equal((await pedir(deps, { cliente_id: ID }, 'x')).status, 403)
    assert.equal(enviados.length + tomas.length, 0)
  })

  it('sin AVISOS_FALTANTES_TOKEN configurado rechaza todo (503)', async () => {
    const { deps, tomas } = montar({ token: undefined })
    assert.equal((await pedir(deps, { cliente_id: ID }, '')).status, 503)
    assert.equal((await pedir(deps, { cliente_id: ID }, 'undefined')).status, 503)
    assert.equal(tomas.length, 0)
  })

  it('rechaza un cliente que no es un uuid y un cuerpo vacío', async () => {
    const { deps, tomas } = montar()
    assert.equal((await pedir(deps, { cliente_id: 'no-es-uuid' })).status, 400)
    assert.equal((await pedir(deps, {})).status, 400)
    assert.equal(tomas.length, 0)
  })

  it('solo acepta POST (y responde el preflight)', async () => {
    const { deps } = montar()
    assert.equal((await pedir(deps, undefined, TOKEN, 'GET')).status, 405)
    assert.equal((await pedir(deps, undefined, TOKEN, 'OPTIONS')).status, 200)
  })
})

describe('enviar-aviso-faltante · destinatario y saneo (m-3, m-4)', () => {
  it('el correo del destinatario es una sola dirección', () => {
    for (const bueno of ['ana@example.com', 'a.b+c@sub.example.com.ar']) assert.equal(CORREO_VALIDO.test(bueno), true, bueno)
    for (const malo of ['a@x.com,b@y.com', 'a@x.com;b@y.com', 'Ana <a@x.com>', '"a"@x.com', 'a@x', 'a b@x.com', 'a@x.com\r\nBcc: z@w.com']) {
      assert.equal(CORREO_VALIDO.test(malo), false, malo)
    }
  })

  it('un destinatario con coma no se envía: cierra como fallido', async () => {
    const { deps, enviados, cierres } = montar({ tomado: [{ ...aEnviar, correo: 'a@x.com,b@y.com' }] })
    assert.deepEqual(await (await pedir(deps, { cliente_id: ID })).json(), { estado: 'fallido' })
    assert.equal(enviados.length, 0)
    assert.equal(cierres[0].error, 'destinatario_invalido')
  })

  it('lineaSegura quita saltos, U+2028/2029, controles e invisibles', () => {
    assert.equal(lineaSegura('a\r\nb\u2028c\u2029d\u0007e\u0085f\u202Eg\u200Bh'), 'a b c d e f g h')
    assert.equal(lineaSegura('  hola  '), 'hola')
  })

  it('codigoDeError clasifica sin devolver el texto del servidor', () => {
    assert.equal(codigoDeError(new DOMException('x', 'TimeoutError')), 'smtp_timeout')
    assert.equal(codigoDeError(new Error('Connection refused')), 'smtp_conexion')
    assert.equal(codigoDeError('cualquier cosa'), 'otro')
  })
})

describe('enviar-aviso-faltante · dot-stuffing (m-5)', () => {
  it('ninguna línea del correo empieza con punto aunque el texto editado lo intente', () => {
    const texto = cuerpoAviso('Ana', [{ producto: 'Funda', sku: null, cantidad: 1, comprobante: 'A-1', mensaje: 'hola\n.\nMAIL FROM:<x>' }])
    assert.equal(texto.split('\n').some((linea) => linea.startsWith('.')), false)
    assert.equal(texto.split('\n').includes('.'), false)
    assert.match(texto, /MAIL FROM:<x>/)
    assert.equal(neutralizarPuntos('a\n.b\n..c'), 'a\n .b\n ..c')
  })
})

describe('_shared/timeout · tope del envío SMTP (M-2)', () => {
  it('corta un envío colgado con TimeoutError', async () => {
    const colgado = new Promise<void>(() => undefined)
    await assert.rejects(conTimeout(colgado, 20), (error: Error) => error.name === 'TimeoutError' && /smtp timeout/.test(error.message))
  })

  it('deja pasar el resultado y el error de un envío que responde a tiempo', async () => {
    assert.equal(await conTimeout(Promise.resolve('ok'), 1000), 'ok')
    await assert.rejects(conTimeout(Promise.reject(new Error('boom')), 1000), /boom/)
  })
})
