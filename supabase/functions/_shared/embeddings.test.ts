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
    await assert.rejects(generarEmbeddings(['a'], 'k', { fetchFn: f.fetchFn, timeoutMs: 20 }), { message: 'EMBEDDING_PROVEEDOR_IA_TIMEOUT' })
    assert.equal(f.senales.length, 1)
  })

  it('el tiempo agotado leyendo el cuerpo también es EMBEDDING_PROVEEDOR_IA_TIMEOUT y no filtra detalle del proveedor', async () => {
    const fetchFn: FetchEmbeddings = () => Promise.resolve({ ok: true, status: 200, json: async () => { throw new DOMException('detalle-interno', 'TimeoutError') } })
    await assert.rejects(generarEmbeddings(['a'], 'k', { fetchFn }), (e: Error) => e.message === 'EMBEDDING_PROVEEDOR_IA_TIMEOUT' && !/detalle-interno/.test(e.message))
  })

  it('un fetch abortado (AbortError) también es EMBEDDING_PROVEEDOR_IA_TIMEOUT, sin filtrar el detalle del error original', async () => {
    const errores = [new DOMException('detalle-interno-1', 'AbortError'), Object.assign(new Error('detalle-interno-2'), { name: 'AbortError' }), { name: 'AbortError', message: 'detalle-interno-3' }]
    for (const original of errores) {
      const fetchFn: FetchEmbeddings = () => Promise.reject(original)
      await assert.rejects(generarEmbeddings(['a'], 'k', { fetchFn }), (e: Error) => e.message === 'EMBEDDING_PROVEEDOR_IA_TIMEOUT' && !/detalle-interno/.test(String(e.message)))
    }
  })

  it('un error hostil (getter de name o Proxy que lanza) se propaga tal cual: leer su nombre no lanza otra cosa', async () => {
    const hostiles = [Object.defineProperty(new Error('x'), 'name', { get() { throw new Error('getter') } }), new Proxy(new Error('x'), { get() { throw new Error('proxy') } })]
    for (const hostil of hostiles) {
      const fetchFn: FetchEmbeddings = () => Promise.reject(hostil)
      let capturado: unknown
      try { await generarEmbeddings(['a'], 'k', { fetchFn }) } catch (e) { capturado = e }
      assert.equal(capturado, hostil)
    }
  })

  it('otros errores del fetch se propagan sin convertirse en timeout', async () => {
    const fetchFn: FetchEmbeddings = () => Promise.reject(new Error('red caída'))
    await assert.rejects(generarEmbeddings(['a'], 'k', { fetchFn }), { message: 'red caída' })
  })

  it('falla si el proveedor responde con error o con otra cantidad de vectores', async () => {
    await assert.rejects(generarEmbeddings(['a'], 'k', { fetchFn: falso({ status: 429 }).fetchFn }), /FALLO_429/)
    const corto: FetchEmbeddings = async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) })
    await assert.rejects(generarEmbeddings(['a'], 'k', { fetchFn: corto }), /RESPUESTA_INVALIDA/)
  })
})
