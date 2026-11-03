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
})
