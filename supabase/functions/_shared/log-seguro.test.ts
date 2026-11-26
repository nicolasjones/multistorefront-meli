import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { leerCampo, limpiarParaLog, mensajeParaLog, normalizarMax, redactarCredenciales, registrarErrorDeBase, textoDeError } from './log-seguro.ts'

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

// Valores hostiles que pueden llegar a un `catch`: getters que lanzan, Proxy con `get` que lanza y Proxy revocado.
export function hostiles(): unknown[] {
  const revocable = Proxy.revocable({}, {})
  revocable.revoke()
  return [
    { get name() { throw new Error('getter name') } },
    { get code() { throw new Error('getter code') } },
    { get message() { throw new Error('getter message') } },
    new Proxy({}, { get() { throw new Error('proxy get') } }),
    revocable.proxy,
  ]
}

describe('valores hostiles: nunca lanzan (se usan dentro de bloques catch)', () => {
  it('leerCampo devuelve undefined en vez de lanzar', () => {
    for (const h of hostiles()) assert.doesNotThrow(() => leerCampo(h, 'name'))
    assert.equal(leerCampo(new Proxy({}, { get() { throw new Error('x') } }), 'name'), undefined)
    assert.equal(leerCampo({ name: 'a' }, 'name'), 'a')
  })

  it('textoDeError devuelve Error con getters que lanzan, Proxy con get que lanza y Proxy revocado', () => {
    for (const h of hostiles()) {
      let texto = ''
      assert.doesNotThrow(() => { texto = textoDeError(h) })
      assert.match(texto, /^Error/)
    }
    assert.equal(textoDeError(new Proxy({}, { get() { throw new Error('x') } })), 'Error')
  })

  it('mensajeParaLog y registrarErrorDeBase no lanzan con valores hostiles', () => {
    const originalError = console.error
    const logs: unknown[][] = []
    console.error = (...a: unknown[]) => { logs.push(a) }
    try {
      for (const h of hostiles()) {
        assert.doesNotThrow(() => mensajeParaLog(h, 300))
        assert.doesNotThrow(() => registrarErrorDeBase('prefijo', h))
        assert.doesNotThrow(() => limpiarParaLog(h, 64))
      }
    } finally { console.error = originalError }
    assert.equal(logs.length, hostiles().length)
    assert.ok(logs.every((l) => l[0] === 'prefijo'))
  })

  it('un code o nombre que parece una credencial (sk-, eyJ, Bearer) se omite aunque cumpla la clase de caracteres', () => {
    for (const code of ['INVALID_API_KEY_sk-abcdefghij0123', 'eyJhbGciOiJIUzI1NiJ9', 'Bearer_abc', 'bearer-x', 'ERR_sk-x']) {
      assert.equal(textoDeError(Object.assign(new Error('x'), { code })), 'Error', code)
      assert.equal(textoDeError(Object.assign(new Error('x'), { name: code })), 'Error', code)
    }
    assert.equal(textoDeError(Object.assign(new Error('x'), { code: 'ECONNRESET' })), 'Error ECONNRESET')
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
    ['{"apikey":"kSECRETO"}', 'JSON apikey sin espacio'],
    ['{"password": "pSECRETO"}', 'JSON password con espacio'],
    ["'secret': 'xSECRETO'", 'comillas simples'],
    ['{"Authorization":"Bearer zSECRETO"}', 'JSON Authorization'],
    ['conexión postgres://user:passSECRETO@db.interna:5432/app falló', 'URL postgres'],
    ['postgresql://u:pSECRETO@h/db', 'URL postgresql'],
    ['redis://:pSECRETO@h:6379', 'URL de otro esquema'],
    ['HTTPS://user:passSECRETO@HOST.example/x', 'URL con esquema en mayúsculas'],
    ['Authorization: Basic dXNlcjpTRUNSRVRP', 'Authorization Basic'],
    ['authorization: Digest username=SECRETO', 'Authorization Digest'],
    ['{"Authorization": "Token tSECRETO"}', 'JSON Authorization con Token'],
    ['cookie sb-access-token=abcSECRETO; otra', 'sb-access-token'],
    ['sb-xyz-auth-token=abcSECRETO', 'sb-…-auth-token'],
    ['{"api_key":"kSECRETO"}', 'JSON api_key'],
    ['DB_PASSWORD=pSECRETO', 'nombre con password embebido'],
    ['x-hasura-admin-secret: sSECRETO', 'secret embebido'],
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
    assert.equal(redactarCredenciales('ver postgres://u:p@h/db ahora'), 'ver [url] ahora')
    assert.equal(redactarCredenciales('ver postgresql://u:p@h/db ahora'), 'ver [url] ahora')
    assert.equal(redactarCredenciales('{"apikey":"k"}'), '{"[campo]=[oculto]')
    assert.equal(redactarCredenciales('HTTPS://x.y/z'), '[url]')
    assert.equal(redactarCredenciales('Authorization: Basic dXNlcjpwYXNz'), '[campo]=[oculto]')
    assert.doesNotMatch(redactarCredenciales('Authorization: Basic dXNlcjpwYXNz'), /Basic|dXNlcjp/)
    assert.equal(redactarCredenciales('sb-access-token=abc'), '[campo]=[oculto]')
    assert.equal(redactarCredenciales('fallo de la base: tabla inexistente'), 'fallo de la base: tabla inexistente')
  })

  it('regex lineales: 200k caracteres hostiles en menos de 300 ms', () => {
    const hostiles = ['a'.repeat(200_000), 'token'.repeat(40_000), `token${' '.repeat(200_000)}x`, 'Bearer '.repeat(30_000), 'eyJ'.repeat(60_000), `eyJ${'a'.repeat(100_000)}.${'b'.repeat(100_000)}`, 'sk-'.repeat(60_000), 'http://'.repeat(30_000), `apikey${'='.repeat(100_000)}`, 'a'.repeat(200_000), 'a://'.repeat(50_000), `apikey${'"'.repeat(100_000)}x`, 'postgres'.repeat(25_000), `${'a-'.repeat(100_000)}token`, `authorization${':'.repeat(100_000)}`, `${'a'.repeat(100_000)} `.repeat(2)]
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

describe('normalizarMax: limpiarParaLog y mensajeParaLog dan el mismo resultado', () => {
  const casos: Array<[unknown, number]> = [[0, 0], [1, 1], [3, 3], [2.7, 2], [-1, 300], [Number.NaN, 300], [Number.POSITIVE_INFINITY, 300], [Number.NEGATIVE_INFINITY, 300], ['5', 300], [undefined, 300], [null, 300]]
  for (const [max, esperado] of casos) {
    it(`max = ${String(max)}`, () => {
      assert.equal(normalizarMax(max), esperado)
      const largo = 'abcdefghij'.repeat(60)
      assert.equal(limpiarParaLog(largo, max as number), largo.slice(0, esperado))
      assert.equal(mensajeParaLog(largo, max as number), largo.slice(0, esperado))
      assert.equal(limpiarParaLog('abcdef', max as number), mensajeParaLog('abcdef', max as number))
    })
  }
})

describe('mensajeParaLog: un secreto que cruza el límite no deja su prefijo', () => {
  const secretos: Array<[string, string]> = [
    ['JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c3VhcmlvIn0.firmaSECRETA1234567890'],
    ['Bearer', 'Bearer tokenSECRETO1234567890abcdef'],
    ['sk-', 'sk-abcdefghijSECRETO0123456789'],
    ['apikey', 'apikey=claveSECRETA1234567890'],
    ['URL', 'https://usuario:claveSECRETA1234@host.interno/ruta?x=1'],
    ['Basic', 'Authorization: Basic dXNlcjpTRUNSRVRPMTIzNDU2'],
  ]
  const ventanas = (secreto: string) => Array.from({ length: secreto.length - 5 }, (_, i) => secreto.slice(i, i + 6))
  for (const [nombre, secreto] of secretos) {
    it(`${nombre}: en 55 desplazamientos alrededor del límite de 300 no queda ningún fragmento de 6 caracteres`, () => {
      const piezas = secreto.split(/[\s=:/@?.]+/).filter((p) => p.length >= 6 && !['Bearer', 'Authorization'].includes(p))
      for (let relleno = 255; relleno <= 309; relleno++) {
        const salida = mensajeParaLog(`${'z'.repeat(relleno)} ${secreto} fin`, 300)
        assert.ok(salida.length <= 300)
        for (const p of piezas) for (const w of ventanas(p)) assert.equal(salida.includes(w), false, `relleno ${relleno}: queda «${w}» en ${salida.slice(-40)}`)
      }
    })
  }
})
