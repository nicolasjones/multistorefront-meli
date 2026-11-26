import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { esTimeoutDeProveedor, limiteDeCupo, limpiarParaLog, rechazoPorCupo } from './cupo-ia.ts'

const textos = { agotado: 'agotado' }
let logs: unknown[][]
let original: typeof console.error
beforeEach(() => { logs = []; original = console.error; console.error = (...a: unknown[]) => { logs.push(a) } })
afterEach(() => { console.error = original })
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
  it('Retry-After: entero hacia arriba y entre 1 y 3600; lo no interpretable cae a 3600', async () => {
    const casos: Array<[unknown, number]> = [
      [1, 1], [0.5, 1], [0.0001, 1], [1.2, 2], [59.01, 60], [60, 60], ['90.5', 91], [1234, 1234], [3600, 3600], [3599.2, 3600], [5000, 3600],
      [null, 3600], ['x', 3600], [0, 3600], [-4, 3600], [Number.NaN, 3600], [Number.POSITIVE_INFINITY, 3600], ['Infinity', 3600], [undefined, 3600], [{}, 3600],
    ]
    for (const [valor, esperado] of casos) {
      const r = await rechazoPorCupo(admin({ data: [{ se_consumio: false, segundos_hasta_reinicio: valor }], error: null }), 'u', 'f', 1, textos)
      assert.equal(r?.retryAfter, esperado, `segundos_hasta_reinicio=${String(valor)}`)
    }
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

describe('rechazoPorCupo: log de servidor', () => {
  const usuario = 'c9000000-0000-0000-0000-000000000001'
  it('registra [cupo-ia] con la funcionalidad y el error en las ramas de error, excepción y respuesta rara, sin el id del usuario', async () => {
    const casos = [
      admin({ data: null, error: { code: '23503', message: `no existe el usuario ${usuario}` } }),
      { rpc: () => { throw new Error(`red ${usuario}`) } },
      { rpc: () => Promise.reject(new Error(`red ${usuario}`)) },
      admin({ data: [], error: null }),
    ]
    for (const a of casos) {
      logs.length = 0
      await rechazoPorCupo(a, usuario, 'chat-ia', 30, textos)
      assert.equal(logs.length, 1)
      assert.match(String(logs[0][0]), /^\[cupo-ia\]/)
      assert.equal((logs[0][1] as { funcionalidad: string }).funcionalidad, 'chat-ia')
      assert.doesNotMatch(JSON.stringify(logs), new RegExp(usuario))
    }
    logs.length = 0
    await rechazoPorCupo(casos[0], usuario, 'chat-ia', 30, textos)
    assert.match(JSON.stringify(logs), /23503/)
    assert.match(JSON.stringify(logs), /\[usuario\]/)
  })

  const otroUuid = 'a1b2c3d4-e5f6-4789-8abc-def012345678'
  const ventanas = (uuid: string) => Array.from({ length: uuid.length - 5 }, (_, i) => uuid.slice(i, i + 6).toLowerCase())
  const logDe = async (message: string, code = '23503') => {
    logs.length = 0
    await rechazoPorCupo(admin({ data: null, error: { code, message } }), usuario, 'chat-ia', 30, textos)
    return String((logs[0][1] as { error: string }).error)
  }

  it('no deja ningún fragmento del uuid del usuario ni de otros uuids, en los formatos reales del detalle de Postgres', async () => {
    const mensajes = [
      `insert or update on table "ia_cupo_uso" violates foreign key constraint. Key (usuario_id)=(${usuario}) is not present in table "users".`,
      `valor "${usuario}" inválido`,
      `${usuario} y otra vez ${usuario}`,
      `Key (usuario_id)=(${usuario.toUpperCase()}) is not present`,
      `usuario ${usuario} organizacion ${otroUuid} fila ${otroUuid.toUpperCase()} correo persona.prueba+1@example.com otro x@y.zz`,
    ]
    for (const m of mensajes) {
      const log = await logDe(m)
      for (const w of [...ventanas(usuario), ...ventanas(otroUuid)]) assert.equal(log.toLowerCase().includes(w), false, `queda «${w}» en: ${log}`)
      assert.equal(log.includes('@'), false, log)
    }
    const mayusculas = await logDe(mensajes[3])
    assert.match(mayusculas, /\[usuario\]/, 'el uuid del usuario en mayúsculas se tacha como [usuario]')
    assert.doesNotMatch(mayusculas, /\[uuid\]/)
    const l = await logDe(mensajes[4])
    assert.match(l, /\[usuario\]/)
    assert.match(l, /\[uuid\]/)
    assert.match(l, /\[correo\]/)
  })

  it('un uuid que cae justo en el límite de 300 caracteres no deja ningún fragmento', async () => {
    for (let relleno = 250; relleno <= 300; relleno++) {
      const log = await logDe(`${'z'.repeat(relleno)} ${usuario} ${otroUuid}`)
      for (const w of [...ventanas(usuario), ...ventanas(otroUuid)]) assert.equal(log.toLowerCase().includes(w), false, `relleno ${relleno}: queda «${w}»`)
      assert.ok(log.length <= 300)
    }
  })

  it('descarta el resto de un uuid cortado al final del detalle (racha de 8 o más hex y guiones)', async () => {
    const log = await logDe(`detalle ${usuario.slice(0, 22)}`)
    assert.equal(/[0-9a-f-]{8,}$/i.test(log), false, log)
    assert.match(log, /detalle$/)
  })

  it('el log es de UNA línea: sin saltos, controles, NUL ni separadores Unicode, y acotado', async () => {
    const log = await logDe('linea\n[cupo-ia] FAKE\r\n[otra] FAKE\u2028x\u2029y\u0000z\u0007w\u007fq')
    assert.equal(/[\r\n\u0000-\u001f\u007f\u2028\u2029]/.test(log), false)
    assert.match(log, /linea \[cupo-ia\] FAKE/)
    assert.equal(logs.length, 1)
    assert.ok((await logDe('x'.repeat(5000))).length <= 300)
  })

  it('regex lineales: 200k caracteres hostiles se procesan en menos de 300 ms', async () => {
    const hostiles = ['a'.repeat(200_000), `${'a'.repeat(100_000)}@${'b'.repeat(100_000)}`, '1-'.repeat(100_000), `${'f'.repeat(199_999)}!`, `${usuario}-`.repeat(5_500), '@'.repeat(200_000)]
    for (const h of hostiles) {
      const t0 = performance.now()
      await logDe(h)
      limpiarParaLog(h, 64)
      assert.ok(performance.now() - t0 < 300, `tardó ${performance.now() - t0} ms`)
    }
  })

  it('no registra nada cuando se consume o se agota el cupo (no son fallos)', async () => {
    await rechazoPorCupo(admin({ data: [{ se_consumio: true }], error: null }), usuario, 'f', 1, textos)
    await rechazoPorCupo(admin({ data: [{ se_consumio: false, segundos_hasta_reinicio: 5 }], error: null }), usuario, 'f', 1, textos)
    assert.deepEqual(logs, [])
  })
})

describe('limpiarParaLog', () => {
  it('una sola línea, acotado a max, y tolera valores no string', () => {
    assert.equal(limpiarParaLog('linea\n[cupo-ia] FAKE', 100), 'linea [cupo-ia] FAKE')
    assert.equal(limpiarParaLog('a\r\nb\u2028c\u2029d\u0000e\u001ff\u007fg', 100), 'a b c d e f g')
    assert.equal(limpiarParaLog('x'.repeat(200), 64).length, 64)
    assert.equal(limpiarParaLog('abcdef', 3), 'abc')
    assert.equal(limpiarParaLog(undefined, 10), 'undefined')
    assert.equal(limpiarParaLog({ toString() { throw new Error('x') } }, 40), '[no representable]')
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
