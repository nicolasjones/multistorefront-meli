// Pruebas de `cupo.ts` (MSF-980): la RPC de cupo inyectada, sin Deno ni Supabase. Corre con `node --test`.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { crearConsumirCupoBaja, TEXTO_CUPO_AGOTADO, TEXTO_CUPO_NO_VERIFICABLE } from './cupo.ts'

type Respuesta = { data: unknown; error: unknown }
function montar(respuesta: () => Promise<Respuesta> | Respuesta) {
  const llamadas: [string, Record<string, unknown>][] = []
  const consumir = crearConsumirCupoBaja(async (nombre, args) => {
    llamadas.push([nombre, args])
    return respuesta()
  })
  return { consumir, llamadas }
}
const callar = async <T>(f: () => Promise<T>): Promise<{ resultado: T; registros: string }> => {
  const registros: unknown[][] = []
  const original = console.error
  console.error = (...args: unknown[]) => { registros.push(args) }
  try { return { resultado: await f(), registros: JSON.stringify(registros) } } finally { console.error = original }
}

describe('crearConsumirCupoBaja', () => {
  it('con cupo (se_consumio true) deja pasar y manda solo la IP a la RPC correcta', async () => {
    const { consumir, llamadas } = montar(() => ({ data: [{ se_consumio: true, segundos_hasta_reinicio: 100 }], error: null }))
    assert.equal(await consumir('10.2.3.4'), null)
    assert.deepEqual(llamadas, [['consumir_cupo_baja_correo', { p_ip: '10.2.3.4' }]])
  })

  it('acepta la fila como objeto (no arreglo)', async () => {
    const { consumir } = montar(() => ({ data: { se_consumio: true }, error: null }))
    assert.equal(await consumir('x'), null)
  })

  it('sin cupo responde 429 con el texto y la espera en segundos', async () => {
    const { consumir } = montar(() => ({ data: [{ se_consumio: false, segundos_hasta_reinicio: 1234 }], error: null }))
    assert.deepEqual(await consumir('x'), { status: 429, error: TEXTO_CUPO_AGOTADO, retryAfter: 1234 })
  })

  it('la espera se redondea hacia arriba y vale 3600 si no es interpretable (tabla)', async () => {
    const casos: [unknown, number][] = [[0.5, 1], [1.2, 2], [3600, 3600], [3601, 3600], [0, 3600], [-5, 3600], ['no', 3600], [null, 3600], [undefined, 3600], [Infinity, 3600]]
    for (const [valor, esperado] of casos) {
      const { consumir } = montar(() => ({ data: [{ se_consumio: false, segundos_hasta_reinicio: valor }], error: null }))
      assert.equal((await consumir('x'))?.retryAfter, esperado, String(valor))
    }
  })

  it('un error de la RPC falla cerrado con 503 y se registra sin la IP', async () => {
    const { consumir } = montar(() => ({ data: null, error: { code: '42883', message: 'function no existe para 10.2.3.4' } }))
    const { resultado, registros } = await callar(() => consumir('10.2.3.4'))
    assert.deepEqual(resultado, { status: 503, error: TEXTO_CUPO_NO_VERIFICABLE })
    assert.ok(registros.includes('42883'), 'queda el código')
  })

  it('una excepción de la RPC (red, timeout) falla cerrado con 503 y solo se registra el nombre del error', async () => {
    const { consumir } = montar(() => { throw Object.assign(new TypeError('fetch failed https://x.supabase.co?apikey=SECRETO'), { code: 'ECONNRESET' }) })
    const { resultado, registros } = await callar(() => consumir('10.2.3.4'))
    assert.deepEqual(resultado, { status: 503, error: TEXTO_CUPO_NO_VERIFICABLE })
    assert.ok(registros.includes('TypeError'))
    assert.ok(!registros.includes('SECRETO') && !registros.includes('supabase.co'), 'ni la URL ni la clave')
  })

  it('una respuesta ilegible falla cerrado con 503 (nula, vacía, sin se_consumio, tipo equivocado)', async () => {
    for (const data of [null, undefined, [], {}, [{}], [{ se_consumio: 'true' }], [{ se_consumio: 1 }], 'texto']) {
      const { consumir } = montar(() => ({ data, error: null }))
      const { resultado } = await callar(() => consumir('x'))
      assert.equal(resultado?.status, 503, JSON.stringify(data))
    }
  })

  it('una respuesta hostil (getter que lanza) tampoco abre el cupo', async () => {
    const hostil = { get se_consumio(): boolean { throw new Error('hostil') } }
    const { consumir } = montar(() => ({ data: [hostil], error: null }))
    const { resultado } = await callar(() => consumir('x'))
    assert.equal(resultado?.status, 503)
  })
})
