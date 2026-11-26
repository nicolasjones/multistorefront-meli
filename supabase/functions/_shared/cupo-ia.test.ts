import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { esTimeoutDeProveedor, limiteDeCupo, rechazoPorCupo } from './cupo-ia.ts'

const textos = { agotado: 'agotado' }
const admin = (resultado: { data: unknown; error: unknown }, llamadas: unknown[] = []) => ({
  rpc: (nombre: string, args: Record<string, unknown>) => { llamadas.push({ nombre, args }); return Promise.resolve(resultado) },
})

describe('limiteDeCupo', () => {
  it('30 por defecto; acepta enteros de 1 a 1000 y todo lo demás vuelve a 30', () => {
    assert.equal(limiteDeCupo(undefined), 30)
    assert.equal(limiteDeCupo('1'), 1)
    assert.equal(limiteDeCupo('10'), 10)
    assert.equal(limiteDeCupo('1000'), 1000)
    for (const v of ['1001', '2147483647', '2147483648', '3000000000', '99999999999', '1e9', '-1', '-1000', '0', 'NaN', 'Infinity', '', ' ', 'abc', '1.5', '2.5', '0x10x']) {
      assert.equal(limiteDeCupo(v), 30, `valor ${JSON.stringify(v)}`)
    }
  })
})

describe('rechazoPorCupo', () => {
  it('consume con los parámetros esperados y deja pasar si se consumió', async () => {
    const llamadas: unknown[] = []
    assert.equal(await rechazoPorCupo(admin({ data: [{ se_consumio: true, usos_actuales: 1, segundos_hasta_reinicio: 10 }], error: null }, llamadas), 'u1', 'chat-ia', 30, textos), null)
    assert.deepEqual(llamadas, [{ nombre: 'consumir_cupo_ia', args: { p_usuario: 'u1', p_funcionalidad: 'chat-ia', p_limite: 30 } }])
  })
  it('429 con Retry-After (segundos hasta el reinicio) si se agotó', async () => {
    assert.deepEqual(await rechazoPorCupo(admin({ data: [{ se_consumio: false, usos_actuales: 30, segundos_hasta_reinicio: 1234 }], error: null }), 'u1', 'chat-ia', 30, textos), { status: 429, error: 'agotado', retryAfter: 1234 })
  })
  it('429 con 3600 si el reinicio no es interpretable', async () => {
    for (const s of [null, 'x', 0, -4]) assert.equal((await rechazoPorCupo(admin({ data: [{ se_consumio: false, segundos_hasta_reinicio: s }], error: null }), 'u', 'f', 1, textos))?.retryAfter, 3600)
  })
  it('503 (falla cerrado, sin detalle) si la RPC lanza, rechaza la promesa o devuelve NULL/formas raras', async () => {
    const esperado = { status: 503, error: 'No se pudo verificar tu cuota de uso.' }
    const lanza = { rpc: () => { throw new Error('detalle-interno') } }
    const rechaza = { rpc: () => Promise.reject(new Error('detalle-interno')) }
    assert.deepEqual(await rechazoPorCupo(lanza, 'u', 'f', 1, textos), esperado)
    assert.deepEqual(await rechazoPorCupo(rechaza, 'u', 'f', 1, textos), esperado)
    for (const data of [null, undefined, 5, 'x', [null], [[]], {}, { se_consumio: null }]) assert.deepEqual(await rechazoPorCupo(admin({ data, error: null }), 'u', 'f', 1, textos), esperado)
    assert.equal(await rechazoPorCupo({ rpc: () => Promise.resolve(null as never) }, 'u', 'f', 1, textos).then(() => 'x', () => 'rechazo-no-controlado'), 'x')
  })

  it('503 (falla cerrado) si la base falla o la respuesta no se entiende', async () => {
    for (const r of [{ data: null, error: { message: 'x' } }, { data: [{ se_consumio: true }], error: { message: 'x' } }, { data: [], error: null }, { data: null, error: null }, { data: [{ se_consumio: 'true' }], error: null }]) {
      assert.deepEqual(await rechazoPorCupo(admin(r), 'u', 'f', 1, textos), { status: 503, error: 'No se pudo verificar tu cuota de uso.' })
    }
  })
})

describe('esTimeoutDeProveedor', () => {
  it('reconoce el timeout y el abort, y no confunde otros errores', () => {
    assert.equal(esTimeoutDeProveedor(new DOMException('x', 'TimeoutError')), true)
    assert.equal(esTimeoutDeProveedor(new DOMException('x', 'AbortError')), true)
    assert.equal(esTimeoutDeProveedor(new Error('INVOCACION_PROVEEDOR_IA_TIMEOUT')), true)
    assert.equal(esTimeoutDeProveedor(new Error('EMBEDDING_PROVEEDOR_IA_TIMEOUT')), true)
    assert.equal(esTimeoutDeProveedor(new Error('INVOCACION_PROVEEDOR_IA_FALLO_500')), false)
    assert.equal(esTimeoutDeProveedor(null), false)
    assert.equal(esTimeoutDeProveedor('TimeoutError'), false)
  })
})
