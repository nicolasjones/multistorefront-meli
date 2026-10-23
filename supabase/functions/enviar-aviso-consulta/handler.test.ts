// Pruebas de `enviar-aviso-consulta` con la base y el SMTP simulados. Corre con `node --test`
// (`pnpm test:edge:enviar-aviso-consulta`); handler.ts y contenido.ts no importan nada de Deno.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { asuntoAviso, cuerpoAviso, enlaceConsulta } from './contenido.ts'
import { MAX_INTENTOS, manejar, type Deps, type Tomado } from './handler.ts'

const ID = '11111111-1111-4111-8111-111111111111'
const TOKEN = 'secreto-de-prueba'
const PANEL = 'https://panel.example.com/'

const aEnviar: Tomado = {
  resultado: 'enviar',
  destinatario: 'avisos@san.example',
  empresa_nombre: 'San Javucho',
  origen: 'formulario',
  nombre: 'Ana Pérez',
  contacto: 'ana@example.com',
  mensaje: 'Hola, ¿tienen stock?',
  producto_nombre: 'Funda',
}
const sin = (resultado: Tomado['resultado']): Tomado => ({ ...aEnviar, resultado, destinatario: null })

type Opciones = {
  tomado?: Tomado
  tomarError?: boolean
  falloSmtp?: string
  cerrarError?: boolean
  pendientes?: string[]
  pendientesError?: boolean
  token?: string | undefined
  panelUrl?: string | undefined
}

function montar(opciones: Opciones = {}) {
  const enviados: { para: string[]; asunto: string; texto: string }[] = []
  const cierres: { id: string; enviado: boolean; error: string | null }[] = []
  const tomas: { id: string; tope: number }[] = []
  const deps: Deps = {
    token: 'token' in opciones ? opciones.token : TOKEN,
    panelUrl: 'panelUrl' in opciones ? opciones.panelUrl : PANEL,
    datos: {
      pendientes: async () => opciones.pendientesError
        ? { data: null, error: { message: 'boom' } }
        : { data: opciones.pendientes ?? [], error: null },
      tomar: async (id, tope) => {
        tomas.push({ id, tope })
        return opciones.tomarError ? { data: null, error: { message: 'boom' } } : { data: [opciones.tomado ?? aEnviar], error: null }
      },
      cerrar: async (id, enviado, error) => {
        cierres.push({ id, enviado, error })
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

describe('enviar-aviso-consulta · envío', () => {
  it('envía un correo con el enlace y marca el aviso como enviado', async () => {
    const { deps, enviados, cierres } = montar()
    const res = await pedir(deps, { consulta_id: ID })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { estado: 'enviado' })
    assert.equal(enviados.length, 1)
    assert.deepEqual(enviados[0].para, ['avisos@san.example'])
    assert.equal(enviados[0].asunto, 'Nueva consulta · San Javucho')
    assert.match(enviados[0].texto, new RegExp(`https://panel\\.example\\.com/consultas\\?consulta=${ID}`))
    assert.match(enviados[0].texto, /Ana Pérez/)
    assert.match(enviados[0].texto, /Funda/)
    assert.deepEqual(cierres, [{ id: ID, enviado: true, error: null }])
  })

  it('el destinatario sale de la base, nunca del pedido', async () => {
    const { deps, enviados } = montar()
    await pedir(deps, { consulta_id: ID, para: 'atacante@evil.com', destinatario: 'atacante@evil.com' })
    assert.deepEqual(enviados[0].para, ['avisos@san.example'])
  })

  it('un fallo de SMTP queda como fallido con el error útil y no lanza', async () => {
    const { deps, cierres } = montar({ falloSmtp: 'connect ECONNREFUSED 127.0.0.1:1025' })
    const res = await pedir(deps, { consulta_id: ID })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { estado: 'fallido' })
    assert.deepEqual(cierres, [{ id: ID, enviado: false, error: 'connect ECONNREFUSED 127.0.0.1:1025' }])
  })

  it('el error guardado se acorta y queda en una sola línea', async () => {
    const { deps, cierres } = montar({ falloSmtp: `línea 1\r\nlínea 2 ${'x'.repeat(1000)}` })
    await pedir(deps, { consulta_id: ID })
    assert.equal(cierres[0].error?.includes('\n'), false)
    assert.ok((cierres[0].error?.length ?? 0) <= 300)
  })

  it('pide a la base el tope de intentos, que es quien corta los reintentos', async () => {
    const { deps, tomas } = montar()
    await pedir(deps, { consulta_id: ID })
    assert.deepEqual(tomas, [{ id: ID, tope: MAX_INTENTOS }])
  })

  it('con el tope agotado no envía ni cierra', async () => {
    const { deps, enviados, cierres } = montar({ tomado: sin('agotado') })
    assert.deepEqual(await (await pedir(deps, { consulta_id: ID })).json(), { estado: 'agotado' })
    assert.equal(enviados.length + cierres.length, 0)
  })

  for (const estado of ['sin_destinatario', 'ya_enviado', 'en_proceso', 'no_existe'] as const) {
    it(`${estado}: lo informa sin enviar ni cerrar`, async () => {
      const { deps, enviados, cierres } = montar({ tomado: sin(estado) })
      assert.deepEqual(await (await pedir(deps, { consulta_id: ID })).json(), { estado })
      assert.equal(enviados.length + cierres.length, 0)
    })
  }

  it('si la base no responde devuelve 502 sin enviar', async () => {
    const { deps, enviados } = montar({ tomarError: true })
    assert.equal((await pedir(deps, { consulta_id: ID })).status, 502)
    assert.equal(enviados.length, 0)
  })

  it('si el correo salió pero no se pudo cerrar, igual informa enviado (al menos una vez)', async () => {
    const { deps } = montar({ cerrarError: true })
    assert.deepEqual(await (await pedir(deps, { consulta_id: ID })).json(), { estado: 'enviado' })
  })
})

describe('enviar-aviso-consulta · barrido', () => {
  it('procesa cada pendiente y resume por estado', async () => {
    const otro = '22222222-2222-4222-8222-222222222222'
    const { deps, enviados } = montar({ pendientes: [ID, otro] })
    const res = await pedir(deps, { barrer: true })
    assert.deepEqual(await res.json(), { procesados: 2, resultados: { enviado: 2 }, errores: 0 })
    assert.equal(enviados.length, 2)
  })

  it('un pendiente que falla no frena a los demás', async () => {
    let n = 0
    const { deps } = montar({ pendientes: [ID, '22222222-2222-4222-8222-222222222222'] })
    const tomar = deps.datos.tomar
    deps.datos.tomar = async (id, tope) => (n++ === 0 ? { data: null, error: { message: 'boom' } } : tomar(id, tope))
    const cuerpo = await (await pedir(deps, { barrer: true })).json()
    assert.deepEqual(cuerpo, { procesados: 2, resultados: { enviado: 1 }, errores: 1 })
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

describe('enviar-aviso-consulta · entrada', () => {
  it('rechaza sin token y con token incorrecto', async () => {
    const { deps, enviados, tomas } = montar()
    assert.equal((await pedir(deps, { consulta_id: ID }, null)).status, 403)
    assert.equal((await pedir(deps, { consulta_id: ID }, 'otro-secreto-')).status, 403)
    assert.equal((await pedir(deps, { consulta_id: ID }, 'x')).status, 403)
    assert.equal(enviados.length + tomas.length, 0)
  })

  it('sin AVISOS_CONSULTAS_TOKEN configurado rechaza todo (503)', async () => {
    const { deps, tomas } = montar({ token: undefined })
    assert.equal((await pedir(deps, { consulta_id: ID }, '')).status, 503)
    assert.equal((await pedir(deps, { consulta_id: ID }, 'undefined')).status, 503)
    assert.equal(tomas.length, 0)
  })

  it('sin PANEL_URL no consume intentos (503)', async () => {
    const { deps, tomas } = montar({ panelUrl: undefined })
    assert.equal((await pedir(deps, { consulta_id: ID })).status, 503)
    assert.equal(tomas.length, 0)
  })

  it('rechaza una consulta que no es un uuid y un cuerpo vacío', async () => {
    const { deps, tomas } = montar()
    assert.equal((await pedir(deps, { consulta_id: 'no-es-uuid' })).status, 400)
    assert.equal((await pedir(deps, {})).status, 400)
    assert.equal(tomas.length, 0)
  })

  it('rechaza métodos distintos de POST', async () => {
    assert.equal((await pedir(montar().deps, null, TOKEN, 'GET')).status, 405)
  })
})

describe('enviar-aviso-consulta · contenido', () => {
  const datos = { empresaNombre: 'San Javucho', origen: 'whatsapp', nombre: 'Ana', contacto: '+54 9 11 5555-1234', mensaje: null, productoNombre: null }

  it('el enlace solo lleva el id de la consulta, sin barra doble ni datos personales', () => {
    assert.equal(enlaceConsulta('https://panel.example.com///', ID.toUpperCase()), `https://panel.example.com/consultas?consulta=${ID}`)
    assert.throws(() => enlaceConsulta(PANEL, 'ana@example.com'), /inválido/)
  })

  it('es texto plano: el HTML del visitante viaja literal, sin interpretarse', () => {
    const texto = cuerpoAviso({ ...datos, mensaje: '<script>alert(1)</script> <b>hola</b>' }, 'https://x/consultas?consulta=1')
    assert.match(texto, /<script>alert\(1\)<\/script> <b>hola<\/b>/)
    assert.doesNotMatch(texto, /<html|<body|text\/html/i)
  })

  it('los saltos de línea en nombre, contacto, empresa y asunto no abren cabeceras ni líneas nuevas', () => {
    const texto = cuerpoAviso({ ...datos, nombre: 'Ana\r\nBcc: robo@evil.com', contacto: 'a@b.com\nCc: x@y.com' }, 'https://x/')
    assert.ok(texto.includes('Nombre: Ana Bcc: robo@evil.com'))
    assert.ok(texto.includes('Contacto: a@b.com Cc: x@y.com'))
    assert.equal(asuntoAviso('Tienda\r\nBcc: robo@evil.com'), 'Nueva consulta · Tienda Bcc: robo@evil.com')
  })

  it('un WhatsApp sin mensaje ni producto lo dice', () => {
    const texto = cuerpoAviso(datos, 'https://x/')
    assert.match(texto, /Origen: WhatsApp/)
    assert.match(texto, /No dejó mensaje\./)
    assert.match(texto, /Producto de interés: Ninguno/)
  })
})
