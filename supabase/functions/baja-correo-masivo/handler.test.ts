// Pruebas de `baja-correo-masivo` (FR-019, SC-004) con la base simulada.
// Corre con `node --test` (`pnpm test:edge:baja-correo-masivo`); el handler no importa nada de Deno ni de Supabase.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'
import { manejar, type Deps } from './handler.ts'
import type { RechazoCupo } from './cupo.ts'

const TOKEN = 'a'.repeat(32) + 'b'.repeat(32)
const hash = (texto: string) => createHash('sha256').update(texto).digest('hex')

// La «base»: conoce un solo token y registra las bajas; una baja repetida no cambia nada (idempotente).
function montar(opciones: { rpcError?: boolean; rechazo?: RechazoCupo | null; saltos?: number } = {}) {
  const llamadas: [string, Record<string, unknown>][] = []
  const ips: string[] = []
  const bajas = new Set<string>()
  const deps: Deps = {
    admin: {
      rpc: async (nombre, args) => {
        llamadas.push([nombre, args])
        if (opciones.rpcError) return { data: null, error: { message: 'boom con detalle interno' } }
        const conocido = args.p_token_hash === hash(TOKEN)
        if (conocido) bajas.add(String(args.p_token_hash))
        return { data: conocido, error: null }
      },
    },
    cupo: async (ip) => {
      ips.push(ip)
      return opciones.rechazo ?? null
    },
    saltosProxy: opciones.saltos ?? 0,
  }
  return { deps, llamadas, bajas, ips }
}

const pedido = (body: unknown, method = 'POST') =>
  new Request('http://localhost/baja-correo-masivo', { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined })

describe('baja-correo-masivo', () => {
  it('con un token válido calcula el hash SHA-256 y da de baja sin mandar el token en claro', async () => {
    const { deps, llamadas, bajas } = montar()
    const res = await manejar(pedido({ token: ` ${TOKEN} ` }), deps)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { ok: true })
    assert.deepEqual(llamadas, [['dar_de_baja_correo_masivo', { p_token_hash: hash(TOKEN) }]])
    assert.ok(!JSON.stringify(llamadas).includes(TOKEN), 'el token en claro no llega a la base')
    assert.equal(bajas.size, 1)
  })

  it('la baja es idempotente: repetirla responde igual y no cambia el estado', async () => {
    const { deps, bajas } = montar()
    const primera = await manejar(pedido({ token: TOKEN }), deps)
    const segunda = await manejar(pedido({ token: TOKEN }), deps)
    assert.equal(primera.status, 200)
    assert.equal(segunda.status, 200)
    assert.deepEqual(await primera.json(), await segunda.json())
    assert.equal(bajas.size, 1)
  })

  it('un token desconocido responde exactamente igual que uno válido (no enumera)', async () => {
    const { deps } = montar()
    const valido = await manejar(pedido({ token: TOKEN }), deps)
    const desconocido = await manejar(pedido({ token: 'c'.repeat(64) }), deps)
    assert.equal(desconocido.status, valido.status)
    assert.deepEqual(await desconocido.json(), await valido.json())
  })

  it('rechaza un cuerpo inválido sin consultar la base', async () => {
    for (const cuerpo of [{}, { token: '' }, { token: 123 }, { token: 'con espacios y ñ' }, { token: 'a'.repeat(129) }, null]) {
      const { deps, llamadas } = montar()
      const res = await manejar(pedido(cuerpo), deps)
      assert.equal(res.status, 400, JSON.stringify(cuerpo))
      assert.equal(llamadas.length, 0)
    }
  })

  it('un fallo de la base responde 500 sin detalle interno', async () => {
    const { deps } = montar({ rpcError: true })
    const res = await manejar(pedido({ token: TOKEN }), deps)
    assert.equal(res.status, 500)
    const texto = JSON.stringify(await res.json())
    assert.ok(!texto.includes('boom'), 'no filtra el mensaje de la base')
  })

  it('solo acepta POST (y responde el preflight de CORS)', async () => {
    const { deps } = montar()
    assert.equal((await manejar(pedido(null, 'GET'), deps)).status, 405)
    assert.equal((await manejar(pedido(null, 'OPTIONS'), deps)).status, 200)
  })

  // CORS: la página de baja corre en el dominio de cada tienda y llama con `supabase.functions.invoke`.
  it('el preflight permite cualquier origen de tienda, el método POST y los encabezados que manda el SDK', async () => {
    const { deps, llamadas } = montar()
    const res = await manejar(new Request('http://localhost/baja-correo-masivo', {
      method: 'OPTIONS',
      headers: { Origin: 'https://tienda-ejemplo.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,apikey,x-client-info,content-type' },
    }), deps)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('access-control-allow-origin'), '*')
    const metodos = (res.headers.get('access-control-allow-methods') ?? '').split(',').map((m) => m.trim())
    assert.ok(metodos.includes('POST') && metodos.includes('OPTIONS'))
    const permitidos = (res.headers.get('access-control-allow-headers') ?? '').split(',').map((h) => h.trim().toLowerCase())
    // Los cuatro que manda `functions.invoke` y los opcionales del SDK (`@supabase/supabase-js/cors`, versión del lockfile).
    for (const h of ['authorization', 'apikey', 'x-client-info', 'content-type', 'x-retry-count', 'traceparent', 'tracestate', 'baggage']) {
      assert.ok(permitidos.includes(h), `el preflight debe permitir ${h}`)
    }
    assert.equal(res.headers.get('access-control-max-age'), '86400')
    assert.equal(res.headers.get('access-control-allow-credentials'), null, 'sin credenciales: es compatible con el origen *')
    assert.equal(llamadas.length, 0, 'un preflight no toca la base')
  })

  it('toda respuesta (ok, datos inválidos, método no soportado y error de la base) lleva el origen permitido', async () => {
    const { deps } = montar()
    const { deps: depsConError } = montar({ rpcError: true })
    const respuestas = [
      await manejar(pedido({ token: TOKEN }), deps),
      await manejar(pedido({ token: 'con espacios y ñ' }), deps),
      await manejar(pedido(null, 'GET'), deps),
      await manejar(pedido({ token: TOKEN }), depsConError),
    ]
    assert.deepEqual(respuestas.map((r) => r.status), [200, 400, 405, 500])
    for (const r of respuestas) assert.equal(r.headers.get('access-control-allow-origin'), '*', `status ${r.status}`)
  })

  it('el contrato no cambia: { token } responde { ok: true } con JSON', async () => {
    const { deps } = montar()
    const res = await manejar(pedido({ token: TOKEN }), deps)
    assert.match(res.headers.get('content-type') ?? '', /application\/json/)
    assert.deepEqual(await res.json(), { ok: true })
  })

  // MSF-980: rate limit por IP, ANTES de leer el cuerpo.
  describe('cupo por IP (MSF-980)', () => {
    const conIp = (xff: string | undefined, body: unknown = { token: TOKEN }) =>
      new Request('http://localhost/baja-correo-masivo', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(xff === undefined ? {} : { 'x-forwarded-for': xff }) }, body: JSON.stringify(body) })

    it('consume el cupo con la IP del cliente (último valor de x-forwarded-for) antes de dar de baja', async () => {
      const { deps, ips, llamadas } = montar()
      const res = await manejar(conIp('9.9.9.9, 10.2.3.4'), deps)
      assert.equal(res.status, 200)
      assert.deepEqual(ips, ['10.2.3.4'])
      assert.equal(llamadas.length, 1)
    })

    it('descuenta los saltos de proxy de confianza configurados', async () => {
      const { deps, ips } = montar({ saltos: 1 })
      await manejar(conIp('1.1.1.1, 2.2.2.2'), deps)
      assert.deepEqual(ips, ['1.1.1.1'])
    })

    it('sin cabecera consume el cupo único sin-ip (no deja pasar sin contar)', async () => {
      const { deps, ips } = montar()
      await manejar(conIp(undefined), deps)
      assert.deepEqual(ips, ['sin-ip'])
    })

    it('sin cupo responde 429 con Retry-After, CORS y sin tocar la base ni leer el token', async () => {
      const { deps, llamadas } = montar({ rechazo: { status: 429, error: 'Hiciste demasiados pedidos seguidos. Probá de nuevo en un rato.', retryAfter: 1234 } })
      const res = await manejar(conIp('10.2.3.4'), deps)
      assert.equal(res.status, 429)
      assert.equal(res.headers.get('retry-after'), '1234')
      assert.equal(res.headers.get('access-control-allow-origin'), '*')
      assert.match(res.headers.get('content-type') ?? '', /application\/json/)
      assert.deepEqual(await res.json(), { error: 'Hiciste demasiados pedidos seguidos. Probá de nuevo en un rato.' })
      assert.equal(llamadas.length, 0)
    })

    it('el 429 no depende del token: uno válido, uno desconocido y un cuerpo inválido reciben exactamente lo mismo (no enumera)', async () => {
      const rechazo: RechazoCupo = { status: 429, error: 'x', retryAfter: 60 }
      const respuestas = []
      for (const cuerpo of [{ token: TOKEN }, { token: 'c'.repeat(64) }, { token: 'con espacios y ñ' }, null]) {
        const { deps } = montar({ rechazo })
        const res = await manejar(conIp('10.2.3.4', cuerpo), deps)
        respuestas.push([res.status, res.headers.get('retry-after'), await res.json()])
      }
      for (const r of respuestas) assert.deepEqual(r, respuestas[0])
    })

    it('si no se puede contar el cupo responde 503 sin Retry-After y no da de baja (falla cerrado)', async () => {
      const { deps, llamadas } = montar({ rechazo: { status: 503, error: 'No pudimos procesar la baja. Probá de nuevo en un rato.' } })
      const res = await manejar(conIp('10.2.3.4'), deps)
      assert.equal(res.status, 503)
      assert.equal(res.headers.get('retry-after'), null)
      assert.equal(llamadas.length, 0)
    })

    it('si el cupo lanza una excepción también responde 503 y no da de baja', async () => {
      const { deps, llamadas } = montar()
      deps.cupo = async () => { throw new Error('boom') }
      const res = await manejar(conIp('10.2.3.4'), deps)
      assert.equal(res.status, 503)
      assert.equal(llamadas.length, 0)
    })

    it('OPTIONS y un método no soportado no gastan cupo', async () => {
      const { deps, ips } = montar()
      await manejar(pedido(null, 'OPTIONS'), deps)
      await manejar(pedido(null, 'GET'), deps)
      assert.deepEqual(ips, [])
    })

    it('un cuerpo inválido sí gasta cupo (la sonda con basura también se limita)', async () => {
      const { deps, ips } = montar()
      const res = await manejar(conIp('10.2.3.4', {}), deps)
      assert.equal(res.status, 400)
      assert.deepEqual(ips, ['10.2.3.4'])
    })
  })

  it('un error de la base se registra con el helper seguro (mensaje saneado) y nunca con el token', async () => {
    const registros: unknown[][] = []
    const original = console.error
    console.error = (...args: unknown[]) => { registros.push(args) }
    try {
      const { deps } = montar({ rpcError: true })
      await manejar(pedido({ token: TOKEN }), deps)
    } finally {
      console.error = original
    }
    assert.ok(registros.length > 0, 'se registró el fallo')
    const texto = JSON.stringify(registros)
    assert.ok(!texto.includes(TOKEN), 'sin el token')
  })
})
