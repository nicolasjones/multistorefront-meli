// Pruebas de `baja-correo-masivo` (FR-019, SC-004) con la base simulada.
// Corre con `node --test` (`pnpm test:edge:baja-correo-masivo`); el handler no importa nada de Deno ni de Supabase.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'
import { manejar, type Deps } from './handler.ts'

const TOKEN = 'a'.repeat(32) + 'b'.repeat(32)
const hash = (texto: string) => createHash('sha256').update(texto).digest('hex')

// La «base»: conoce un solo token y registra las bajas; una baja repetida no cambia nada (idempotente).
function montar(opciones: { rpcError?: boolean } = {}) {
  const llamadas: [string, Record<string, unknown>][] = []
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
  }
  return { deps, llamadas, bajas }
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
})
