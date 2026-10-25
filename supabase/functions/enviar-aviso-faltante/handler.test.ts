// Pruebas de `enviar-aviso-faltante` con la base y el SMTP simulados. Corre con `node --test`
// (`pnpm test:edge:enviar-aviso-faltante`); handler.ts y contenido.ts no importan nada de Deno.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { asuntoAviso, cuerpoAviso } from './contenido.ts'
import { MAX_INTENTOS, manejar, type Deps, type Tomado } from './handler.ts'

const ID = '11111111-1111-4111-8111-111111111111'
const TOKEN = 'secreto-de-prueba'

const aEnviar: Tomado = {
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
  const cierres: { id: string; enviado: boolean; error: string | null; tope: number }[] = []
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
      cerrar: async (id, enviado, error, tope) => {
        cierres.push({ id, enviado, error, tope })
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
    assert.deepEqual(cierres, [{ id: ID, enviado: true, error: null, tope: MAX_INTENTOS }])
  })

  it('el destinatario sale de la base, nunca del pedido', async () => {
    const { deps, enviados } = montar()
    await pedir(deps, { cliente_id: ID, para: 'atacante@evil.com', correo: 'atacante@evil.com' })
    assert.deepEqual(enviados[0].para, ['ana@example.com'])
  })

  it('un fallo de SMTP queda como fallido con el error útil y no lanza', async () => {
    const { deps, cierres } = montar({ falloSmtp: 'connect ECONNREFUSED 127.0.0.1:1025' })
    const res = await pedir(deps, { cliente_id: ID })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { estado: 'fallido' })
    assert.deepEqual(cierres, [{ id: ID, enviado: false, error: 'connect ECONNREFUSED 127.0.0.1:1025', tope: MAX_INTENTOS }])
  })

  it('el error guardado se acorta y queda en una sola línea', async () => {
    const { deps, cierres } = montar({ falloSmtp: `línea 1\r\nlínea 2 ${'x'.repeat(1000)}` })
    await pedir(deps, { cliente_id: ID })
    assert.equal(cierres[0].error?.includes('\n'), false)
    assert.ok((cierres[0].error?.length ?? 0) <= 300)
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
    assert.match(cierres[0].error ?? '', /no es una dirección válida/)
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
