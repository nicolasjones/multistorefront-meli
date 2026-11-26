// Compartido entre indexar-documento y preguntar-documentos — OpenAI es el único proveedor de embeddings soportado
// (research.md R8). Sin imports de Deno: se prueba con `node --test` (embeddings.test.ts).
//
// La API de OpenAI limita cada request a 2048 ítems y ~300k tokens: se envía por lotes de `TAMANO_LOTE` (un documento
// grande ya no falla siempre) y cada request lleva su propio tope de espera, para que un proveedor colgado no ocupe el
// isolate hasta el límite de la plataforma.
export const TAMANO_LOTE = 256
export const TIMEOUT_EMBEDDINGS_MS = 30_000

export type FetchEmbeddings = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export async function generarEmbeddings(
  textos: string[],
  clave: string,
  opciones: { fetchFn?: FetchEmbeddings; timeoutMs?: number; tamanoLote?: number } = {},
): Promise<number[][]> {
  const fetchFn = opciones.fetchFn ?? (fetch as unknown as FetchEmbeddings)
  const timeoutMs = opciones.timeoutMs ?? TIMEOUT_EMBEDDINGS_MS
  const tamano = opciones.tamanoLote ?? TAMANO_LOTE
  const resultado: number[][] = []
  for (let i = 0; i < textos.length; i += tamano) {
    const lote = textos.slice(i, i + tamano)
    let cuerpo: { data?: Array<{ embedding: number[] }> }
    try {
      const respuesta = await fetchFn('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: lote }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!respuesta.ok) throw new Error(`EMBEDDING_PROVEEDOR_IA_FALLO_${respuesta.status}`)
      cuerpo = await respuesta.json() as { data?: Array<{ embedding: number[] }> }
    } catch (error) {
      // Tiempo agotado (también leyendo el cuerpo): error de negocio sin detalle del proveedor.
      let nombre: unknown
      try { nombre = error && typeof error === 'object' ? (error as { name?: unknown }).name : undefined } catch { nombre = undefined }
      if (nombre === 'TimeoutError' || nombre === 'AbortError') throw new Error('EMBEDDING_PROVEEDOR_IA_TIMEOUT')
      throw error
    }
    if (!Array.isArray(cuerpo.data) || cuerpo.data.length !== lote.length) throw new Error('EMBEDDING_PROVEEDOR_IA_RESPUESTA_INVALIDA')
    resultado.push(...cuerpo.data.map((item) => item.embedding))
  }
  return resultado
}

export async function generarEmbedding(texto: string, clave: string, opciones?: { fetchFn?: FetchEmbeddings; timeoutMs?: number }): Promise<number[]> {
  const [embedding] = await generarEmbeddings([texto], clave, opciones)
  return embedding
}
