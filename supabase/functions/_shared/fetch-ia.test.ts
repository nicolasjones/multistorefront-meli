import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fetchConTimeout } from './fetch-ia.ts'

describe('fetchConTimeout', () => {
  it('agrega una señal de timeout y corta un proveedor colgado', async () => {
    let senal: AbortSignal | undefined
    const colgado = (_u: string, init: { signal?: AbortSignal }) => {
      senal = init.signal
      return new Promise<never>((_, rechazar) => init.signal!.addEventListener('abort', () => rechazar(new DOMException('t', 'TimeoutError'))))
    }
    const f = fetchConTimeout(0.02, colgado as never)
    await assert.rejects(f('http://x', { method: 'POST', headers: {}, body: '{}' }), { name: 'TimeoutError' })
    assert.ok(senal)
  })

  it('acota el límite a 90 segundos y usa 60 si el valor no es válido', async () => {
    const señales: AbortSignal[] = []
    const base = async (_u: string, init: { signal?: AbortSignal }) => { señales.push(init.signal!); return { ok: true, status: 200, json: async () => ({}) } }
    await fetchConTimeout(10_000, base as never)('u', { method: 'POST', headers: {}, body: '' })
    await fetchConTimeout(Number.NaN, base as never)('u', { method: 'POST', headers: {}, body: '' })
    assert.equal(señales.length, 2)
    assert.equal(señales.every((s) => !s.aborted), true)
  })
})
