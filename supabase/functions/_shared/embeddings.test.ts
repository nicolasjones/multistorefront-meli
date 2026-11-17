// `node --test supabase/functions/_shared/embeddings.test.ts` (pnpm test:edge:embeddings).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { generarEmbeddings, type FetchEmbeddings } from './embeddings.ts'

function falso(opciones: { status?: number; colgar?: boolean } = {}) {
  const lotes: number[] = []
  const senales: AbortSignal[] = []
  const fetchFn: FetchEmbeddings = (_url, init) => {
    senales.push(init.signal)
    if (opciones.colgar) return new Promise((_, rechazar) => init.signal.addEventListener('abort', () => rechazar(new DOMException('t', 'TimeoutError'))))
    const entrada = (JSON.parse(init.body) as { input: string[] }).input
    lotes.push(entrada.length)
    return Promise.resolve({
      ok: (opciones.status ?? 200) < 400,
      status: opciones.status ?? 200,
      json: async () => ({ data: entrada.map((t) => ({ embedding: [t.length] })) }),
    })
  }
  return { fetchFn, lotes, senales }
}

describe('generarEmbeddings', () => {
  it('divide en lotes y conserva el orden', async () => {
    const f = falso()
    const textos = Array.from({ length: 600 }, (_, i) => 'x'.repeat(i + 1))
    const res = await generarEmbeddings(textos, 'k', { fetchFn: f.fetchFn, tamanoLote: 256 })
    assert.deepEqual(f.lotes, [256, 256, 88])
    assert.equal(res.length, 600)
    assert.deepEqual(res[599], [600])
  })

  it('manda una señal de timeout en cada request y corta un proveedor colgado', async () => {
    const f = falso({ colgar: true })
    await assert.rejects(generarEmbeddings(['a'], 'k', { fetchFn: f.fetchFn, timeoutMs: 20 }), { name: 'TimeoutError' })
    assert.equal(f.senales.length, 1)
  })

  it('falla si el proveedor responde con error o con otra cantidad de vectores', async () => {
    await assert.rejects(generarEmbeddings(['a'], 'k', { fetchFn: falso({ status: 429 }).fetchFn }), /FALLO_429/)
    const corto: FetchEmbeddings = async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) })
    await assert.rejects(generarEmbeddings(['a'], 'k', { fetchFn: corto }), /RESPUESTA_INVALIDA/)
  })
})
