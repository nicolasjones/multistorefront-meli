import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { limpiarParaLog, mensajeParaLog, redactarCredenciales, registrarErrorDeBase, textoDeError } from './log-seguro.ts'

describe('limpiarParaLog', () => {
  it('una sola línea, acotado a max, y tolera valores no string', () => {
    assert.equal(limpiarParaLog('linea\n[cupo-ia] FAKE', 100), 'linea [cupo-ia] FAKE')
    assert.equal(limpiarParaLog('a\r\nb\u2028c\u2029d\u0000e\u001ff\u007fg', 100), 'a b c d e f g')
    assert.equal(limpiarParaLog('x'.repeat(200), 64).length, 64)
    assert.equal(limpiarParaLog('abcdef', 3), 'abc')
    assert.equal(limpiarParaLog(undefined, 10), 'undefined')
    assert.equal(limpiarParaLog({ toString() { throw new Error('x') } }, 40), '[no representable]')
  })

  it('no deja un par sustituto partido al final (emoji en el límite, varios desplazamientos)', () => {
    for (let relleno = 5; relleno <= 12; relleno++) {
      const texto = limpiarParaLog(`${'a'.repeat(relleno)}😀😀`, 10)
      assert.ok(texto.length <= 10)
      const ultimo = texto.charCodeAt(texto.length - 1)
      assert.equal(ultimo >= 0xd800 && ultimo <= 0xdbff, false, `relleno ${relleno}`)
      assert.equal(/\p{Surrogate}/u.test(texto), false, `relleno ${relleno}`)
    }
    assert.equal(limpiarParaLog('ab😀cd', 3), 'ab')
    assert.equal(limpiarParaLog('ab\udbffcd', 3), 'ab')
    assert.equal(limpiarParaLog('ab\ud800cd', 3), 'ab')
    assert.equal(limpiarParaLog('ab\udc00cd', 3), 'ab\udc00')
    assert.equal(limpiarParaLog('ab😀cd', 4), 'ab😀')
    assert.equal(limpiarParaLog('aaaaaaaaa😀', 10), 'aaaaaaaaa')
    assert.equal(limpiarParaLog('aaaaaaaa😀', 10), 'aaaaaaaa😀')
  })

  it('recorta ANTES de limpiar: 10 MB con saltos alternados en menos de 100 ms y respetando el máximo', () => {
    const enorme = 'a\n'.repeat(5_000_000)
    const t0 = performance.now()
    const salida = limpiarParaLog(enorme, 300)
    assert.ok(performance.now() - t0 < 100, `tardó ${performance.now() - t0} ms`)
    assert.ok(salida.length <= 300 && salida.length > 0)
    assert.equal(/[\r\n]/.test(salida), false)
  })
})

describe('textoDeError', () => {
  it('imprime solo el nombre y un code corto: nunca el mensaje, la cause ni la URL de un fallo de fetch', () => {
    const error = new TypeError('fetch failed: https://api.x/y?apikey=SECRETO', { cause: new Error('Bearer SECRETO https://api.x/y?apikey=SECRETO') })
    const texto = textoDeError(error)
    assert.equal(texto, 'TypeError')
    assert.doesNotMatch(texto, /SECRETO|https?:|api\.x/)
    assert.equal(textoDeError(new DOMException('abortado con SECRETO', 'AbortError')), 'AbortError')
  })

  it('conserva un code corto y simple, y omite el que no cumple', () => {
    assert.equal(textoDeError(Object.assign(new Error('x SECRETO'), { code: 'ECONNRESET' })), 'Error ECONNRESET')
    assert.equal(textoDeError(Object.assign(new Error('x'), { code: 'con espacios SECRETO' })), 'Error')
    assert.equal(textoDeError(Object.assign(new Error('x'), { code: 'A'.repeat(65) })), 'Error')
    assert.equal(textoDeError(Object.assign(new Error('x'), { code: 5 })), 'Error')
  })

  it('conserva los códigos propios de la plataforma (segmento IA) y descarta cualquier otro mensaje', () => {
    for (const codigo of ['EMBEDDING_PROVEEDOR_IA_TIMEOUT', 'INVOCACION_PROVEEDOR_IA_FALLO_500', 'POLITICA_IA_INACTIVA', 'LIMITE_INTENTOS_IA', 'PERSISTENCIA_CHAT_FALLIDA']) {
      assert.equal(textoDeError(new Error(codigo)), `Error ${codigo}`)
    }
    for (const mensaje of ['SECRETO', 'SK_SECRETO_X', 'clave-proveedor-secreta', `${'A_'.repeat(40)}IA`, 'ECONNRESET sk-abc']) assert.equal(textoDeError(new Error(mensaje)), 'Error', mensaje)
  })

  it('un nombre raro se reemplaza por Error y los valores no objeto salen como su tipo', () => {
    assert.equal(textoDeError(Object.assign(new Error('x'), { name: 'Nombre con SECRETO' })), 'Error')
    assert.equal(textoDeError('texto con SECRETO'), 'string')
    assert.equal(textoDeError(null), 'object')
    assert.equal(textoDeError(undefined), 'undefined')
    assert.equal(textoDeError({ name: 'AbortError' }), 'AbortError')
  })
})

describe('redactarCredenciales', () => {
  const casos: Array<[string, string]> = [
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c3VhcmlvIn0.firmaSECRETA123', 'JWT completo'],
    ['Bearer abc123SECRETO', 'Bearer'],
    ['Authorization: Bearer xSECRETO', 'Authorization con Bearer'],
    ['x-api-key: kSECRETO', 'x-api-key'],
    ['fallo en ?apikey=kSECRETO&x=1', 'apikey en query'],
    ['clave sk-abcdefghijSECRETO0123', 'sk-'],
    ['https://user:passSECRETO@host.example/ruta?x=1', 'URL con credenciales'],
    ['password = hunter2SECRETO', 'password'],
    ['TOKEN: tSECRETO y API_KEY=aSECRETO', 'campos en mayúsculas'],
    ['secret:sSECRETO', 'secret sin espacio'],
  ]
  for (const [entrada, nombre] of casos) {
    it(`redacta ${nombre}`, () => {
      const salida = redactarCredenciales(entrada)
      assert.doesNotMatch(salida, /SECRETO|hunter2|abc123|passSECRETO/, salida)
    })
  }

  it('usa las marcas esperadas y no toca el texto sin credenciales', () => {
    assert.equal(redactarCredenciales('Bearer abc'), 'Bearer [token]')
    assert.match(redactarCredenciales('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c3VhcmlvIn0.firma12345'), /^\[jwt\]$/)
    assert.equal(redactarCredenciales('sk-abcdefghij0123'), '[clave]')
    assert.equal(redactarCredenciales('apikey=k'), '[campo]=[oculto]')
    assert.equal(redactarCredenciales('ver https://a.b/c?d=1 ahora'), 'ver [url] ahora')
    assert.equal(redactarCredenciales('fallo de la base: tabla inexistente'), 'fallo de la base: tabla inexistente')
  })

  it('regex lineales: 200k caracteres hostiles en menos de 300 ms', () => {
    const hostiles = ['a'.repeat(200_000), 'token'.repeat(40_000), `token${' '.repeat(200_000)}x`, 'Bearer '.repeat(30_000), 'eyJ'.repeat(60_000), `eyJ${'a'.repeat(100_000)}.${'b'.repeat(100_000)}`, 'sk-'.repeat(60_000), 'http://'.repeat(30_000), `apikey${'='.repeat(100_000)}`]
    for (const h of hostiles) {
      const t0 = performance.now()
      redactarCredenciales(h.slice(0, 8000))
      assert.ok(performance.now() - t0 < 300, `${h.slice(0, 12)} tardó ${performance.now() - t0} ms`)
    }
  })
})

describe('mensajeParaLog y registrarErrorDeBase', () => {
  let logs: unknown[][]
  let original: typeof console.error
  beforeEach(() => { logs = []; original = console.error; console.error = (...a: unknown[]) => { logs.push(a) } })
  afterEach(() => { console.error = original })

  it('mensajeParaLog: una línea, credenciales redactadas y acotado', () => {
    const texto = mensajeParaLog(`boom\nBearer SECRETO ${'z'.repeat(1000)}`, 300)
    assert.equal(/[\r\n]/.test(texto), false)
    assert.doesNotMatch(texto, /SECRETO/)
    assert.ok(texto.length <= 300)
  })

  it('registrarErrorDeBase: prefijo, código acotado a 64 y mensaje saneado', () => {
    registrarErrorDeBase('indexar-documento: x', { code: `42501${'9'.repeat(100)}\n`, message: 'fallo\nBearer SECRETO https://a.b/c?apikey=SECRETO' })
    assert.equal(logs.length, 1)
    assert.equal(logs[0][0], 'indexar-documento: x')
    assert.ok(String(logs[0][1]).length <= 64 && !/[\r\n]/.test(String(logs[0][1])))
    assert.doesNotMatch(String(logs[0][2]), /SECRETO|\n/)
    registrarErrorDeBase('p', {})
    assert.deepEqual(logs[1], ['p', '', 'undefined'])
  })
})
