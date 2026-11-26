import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { MAX_ENTRADA_REDACCION, leerCampo, limpiarParaLog, mensajeParaLog, normalizarMax, redactarCredenciales, registrarErrorDeBase, textoDeError } from './log-seguro.ts'

// Medición robusta a CPU cargada: si la primera corrida pasa del tope se repite 2 veces más y se compara el MÍNIMO (código correcto mide
// milisegundos; una regex cuadrática de verdad mide segundos en las tres). Los topes tienen margen amplio sobre lo medido.
function minimoMs(fn: () => unknown, tope: number): number {
  let mejor = Infinity
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now()
    fn()
    mejor = Math.min(mejor, performance.now() - t0)
    if (mejor < tope) break
  }
  return mejor
}

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

  it('el margen previo al saneo es exactamente max * 4: se descarta lo que queda más allá, ni más ni menos', () => {
    // max = 3: se mira solo los primeros 12 caracteres; 11 saltos colapsan en un espacio y el resto ('bcd') queda afuera.
    assert.equal(limpiarParaLog(`a${'\n'.repeat(11)}bcd`, 3), 'a ')
    // Con 8 saltos caben 'bc' dentro de los 12 caracteres: 'a bc' acotado a 3 -> 'a b'.
    assert.equal(limpiarParaLog(`a${'\n'.repeat(8)}bc`, 3), 'a b')
    assert.equal(limpiarParaLog(`a${'\n'.repeat(10)}bc`, 3), 'a b')
    assert.equal(limpiarParaLog(`a${'\n'.repeat(11)}b`, 3), 'a ')
  })

  it('límites del recorte: max - 1, max y max + 1 caracteres', () => {
    assert.equal(limpiarParaLog('abcd', 3), 'abc')
    assert.equal(limpiarParaLog('abc', 3), 'abc')
    assert.equal(limpiarParaLog('ab', 3), 'ab')
    assert.equal(limpiarParaLog('abcde', 5), 'abcde')
    assert.equal(limpiarParaLog('abcdef', 5), 'abcde')
  })

  it('recorta ANTES de limpiar: 10 MB con saltos alternados en menos de 400 ms (mínimo de hasta 3 corridas) y respetando el máximo', () => {
    const enorme = 'a\n'.repeat(5_000_000)
    const ms = minimoMs(() => limpiarParaLog(enorme, 300), 400)
    assert.ok(ms < 400, `tardó ${ms} ms`)
    const salida = limpiarParaLog(enorme, 300)
    assert.ok(salida.length <= 300 && salida.length > 0)
    assert.equal(/[\r\n]/.test(salida), false)
  })
})

describe('textoDeError: cada lectura es segura por separado', () => {
  it('con un solo campo hostil el resultado exacto conserva los demás', () => {
    const lanza = () => { throw new Error('hostil') }
    assert.equal(textoDeError({ name: 'TypeError', get code() { return lanza() }, message: 'x' }), 'TypeError')
    assert.equal(textoDeError({ get name() { return lanza() }, code: 'ECONNRESET', message: 'x' }), 'Error ECONNRESET')
    assert.equal(textoDeError({ name: 'RangeError', get message() { return lanza() } }), 'RangeError')
    assert.equal(textoDeError({ get name() { return lanza() }, get code() { return lanza() }, message: 'POLITICA_IA_INACTIVA' }), 'Error POLITICA_IA_INACTIVA')
    assert.equal(textoDeError({ name: 'TypeError', code: 'E_X', get message() { return lanza() } }), 'TypeError E_X')
  })
})

describe('textoDeError: bordes numéricos (n-1, n, n+1)', () => {
  it('un código propio de la plataforma se imprime hasta 64 caracteres y no con 65', () => {
    const propio = (largo: number) => `${'A'.repeat(largo - 3)}_IA`
    for (const largo of [10, 63, 64]) assert.equal(textoDeError(new Error(propio(largo))), `Error ${propio(largo)}`, `largo ${largo}`)
    for (const largo of [65, 66, 200]) assert.equal(textoDeError(new Error(propio(largo))), 'Error', `largo ${largo}`)
  })

  it('el `code` simple se imprime hasta 64 caracteres y se omite con 65 o con caracteres fuera de la clase', () => {
    for (const largo of [1, 63, 64]) assert.equal(textoDeError(Object.assign(new Error('x'), { code: 'C'.repeat(largo) })), `Error ${'C'.repeat(largo)}`, `largo ${largo}`)
    for (const largo of [65, 66]) assert.equal(textoDeError(Object.assign(new Error('x'), { code: 'C'.repeat(largo) })), 'Error', `largo ${largo}`)
    assert.equal(textoDeError(Object.assign(new Error('x'), { code: '' })), 'Error')
  })

  it('el nombre se imprime hasta 64 caracteres; con 65 o vacío se usa Error', () => {
    for (const largo of [1, 63, 64]) assert.equal(textoDeError(Object.assign(new Error('x'), { name: 'N'.repeat(largo) })), 'N'.repeat(largo), `largo ${largo}`)
    for (const largo of [65, 66]) assert.equal(textoDeError(Object.assign(new Error('x'), { name: 'N'.repeat(largo) })), 'Error', `largo ${largo}`)
    assert.equal(textoDeError(Object.assign(new Error('x'), { name: '' })), 'Error')
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
    ['DB_PASSWD=pSECRETO', 'passwd'],
    ['secret_key=sSECRETO', 'sufijo después de secret'],
    ['token_value: tSECRETO', 'sufijo después de token'],
    ['password_hash: hSECRETO', 'sufijo después de password'],
    ['AUTHORIZATION: BASIC dXNlcjpTRUNSRVRP', 'Authorization en mayúsculas'],
  ]
  for (const [entrada, nombre] of casos) {
    it(`redacta ${nombre}`, () => {
      const salida = redactarCredenciales(entrada)
      assert.doesNotMatch(salida, /SECRETO|hunter2|abc123|passSECRETO/, salida)
    })
  }

  it('valores con espacios, comillas o JSON escapado: a partir de un campo sensible se oculta TODO el resto del mensaje', () => {
    const casos: Array<[string, string]> = [
      ['{"password":"p w SECRETO"}', '{"password": [oculto]'],
      ['DB_PASSWORD="my pass SECRETO"', 'DB_PASSWORD= [oculto]'],
      ['{"token":"abc def SECRETO"}', '{"token": [oculto]'],
      ['password: my pass SECRETO phrase', 'password: [oculto]'],
      ['Authorization: Digest username="u", response="rSECRETO"', 'Authorization: [oculto]'],
      ['{\\"api_key\\":\\"kSECRETO\\"}', '{\\"api_key\\": [oculto]'],
      ['Authorization: tokenSECRETO', 'Authorization: [oculto]'],
      ['authorization:Bearer xSECRETO', 'authorization: [oculto]'],
      ['fallo antes de la clave. cookie: sid=SECRETO; otra=SECRETO2', 'fallo antes de la clave. cookie: [oculto]'],
      ['credential = {"user":"u","pass":"SECRETO"}', 'credential = [oculto]'],
    ]
    for (const [entrada, esperado] of casos) {
      const salida = redactarCredenciales(entrada)
      assert.equal(salida, esperado, entrada)
      assert.doesNotMatch(salida, /SECRETO|Digest|Basic/, entrada)
    }
  })

  it('un mensaje legítimo sin campos sensibles queda intacto', () => {
    for (const texto of ['insert or update on table "ia_cupo_uso" violates foreign key constraint "ia_cupo_uso_usuario_id_fkey"', 'permission denied for table tokens', 'relation "usuarios" does not exist', 'commit deadbeef 0xdeadbeef error 12345678', 'el límite debe ser un entero entre 1 y 1000']) {
      assert.equal(redactarCredenciales(texto), texto)
    }
  })

  it('usa las marcas esperadas y no toca el texto sin credenciales', () => {
    assert.equal(redactarCredenciales('Bearer abc'), 'Bearer [token]')
    assert.match(redactarCredenciales('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c3VhcmlvIn0.firma12345'), /^\[jwt\]$/)
    assert.equal(redactarCredenciales('sk-abcdefghij0123'), '[clave]')
    assert.equal(redactarCredenciales('apikey=k'), 'apikey= [oculto]')
    assert.equal(redactarCredenciales('ver https://a.b/c?d=1 ahora'), 'ver [url] ahora')
    assert.equal(redactarCredenciales('ver postgres://u:p@h/db ahora'), 'ver [url] ahora')
    assert.equal(redactarCredenciales('ver postgresql://u:p@h/db ahora'), 'ver [url] ahora')
    assert.equal(redactarCredenciales('{"apikey":"k"}'), '{"apikey": [oculto]')
    assert.equal(redactarCredenciales('HTTPS://x.y/z'), '[url]')
    assert.equal(redactarCredenciales('Authorization: Basic dXNlcjpwYXNz'), 'Authorization: [oculto]')
    assert.doesNotMatch(redactarCredenciales('Authorization: Basic dXNlcjpwYXNz'), /Basic|dXNlcjp/)
    assert.equal(redactarCredenciales('sb-access-token=abc'), 'sb-access-token= [oculto]')
    assert.equal(redactarCredenciales('fallo de la base: tabla inexistente'), 'fallo de la base: tabla inexistente')
  })

  it('tiempo acotado: 200k caracteres hostiles por variante, directo sobre redactarCredenciales (sin el pre-recorte de los llamadores), cada uno en menos de 1 s', () => {
    const rep = (pieza: string, veces: number) => pieza.repeat(veces)
    const hostiles: Array<[string, string]> = [
      ['eyJ×66k', rep('eyJ', 66_000)], ['eyJ.×50k', rep('eyJ.', 50_000)], ['eyJa.eyJa.×30k', rep('eyJa.', 60_000)], ['sb-×60k', rep('sb-', 60_000)],
      ['token×40k + =', `${rep('token', 40_000)}=`], ['a-×100k', rep('a-', 100_000)], ['://×66k', rep('://', 66_000)], ['a://×50k', rep('a://', 50_000)],
      ['espacios×200k', ' '.repeat(200_000)], ['Bearer ×30k', rep('Bearer ', 30_000)], ['authorization:×10k', rep('authorization:', 10_000)],
      ['x_token×30k', rep('x_token', 30_000)], ['prefijo de 40 + token', rep(`${'a'.repeat(40)}token`, 4_000)], ['apikey + comillas', `apikey${'"'.repeat(100_000)}x`],
      ['eyJ + segmentos enormes', `eyJ${'a'.repeat(100_000)}.${'b'.repeat(100_000)}`], ['postgres×25k', rep('postgres', 25_000)], ['sk-×60k', rep('sk-', 60_000)],
      ['authorization + espacios', `authorization:${' '.repeat(100_000)}x`], ['a×200k', 'a'.repeat(200_000)], ['eyJ + a×2000 + . repetido', rep(`eyJ${'a'.repeat(1_990)}.`, 100)],
    ]
    for (const [nombre, h] of hostiles) {
      const ms = minimoMs(() => redactarCredenciales(h), 1000)
      const salida = redactarCredenciales(h)
      assert.ok(ms < 1000, `${nombre} tardó ${ms} ms (mínimo de hasta 3 corridas)`)
      assert.ok(salida.length <= 2 * MAX_ENTRADA_REDACCION, `${nombre}: la salida debe quedar acotada (${salida.length})`)
    }
  })

  it('el tope de entrada es EXACTAMENTE 4000 caracteres (la constante no se compara consigo misma)', () => {
    assert.equal(MAX_ENTRADA_REDACCION, 4000)
    assert.equal(redactarCredenciales('a'.repeat(3999)), 'a'.repeat(3999))
    assert.equal(redactarCredenciales('a'.repeat(4000)), 'a'.repeat(4000))
    assert.equal(redactarCredenciales(`${'a'.repeat(4000)}X`), 'a'.repeat(4000))
    assert.equal(redactarCredenciales('a'.repeat(4001)).length, 4000)
    // Un secreto que termina justo en la posición 4000 se redacta; uno que empieza después se descarta (no sale ni redactado).
    const conSecreto = `${'z'.repeat(4000 - 19)}Bearer abcdefghijkl`
    assert.equal(conSecreto.length, 4000)
    assert.equal(redactarCredenciales(conSecreto), `${'z'.repeat(4000 - 19)}Bearer [token]`)
    const despues = `${'z'.repeat(4001)}Bearer SECRETO`
    assert.equal(redactarCredenciales(despues), 'z'.repeat(4000))
  })

  it('un texto de más de MAX_ENTRADA_REDACCION caracteres sale acotado y lo que está dentro del tope se redacta', () => {
    const salida = redactarCredenciales(`Bearer abcSECRETO ${'x'.repeat(10_000)}`)
    assert.equal(salida.startsWith('Bearer [token] '), true)
    assert.ok(salida.length <= 2 * MAX_ENTRADA_REDACCION)
    assert.equal(redactarCredenciales('a'.repeat(MAX_ENTRADA_REDACCION)).length, MAX_ENTRADA_REDACCION)
    assert.equal(redactarCredenciales('a'.repeat(MAX_ENTRADA_REDACCION + 1)).length, MAX_ENTRADA_REDACCION)
  })

  it('un JWT con segmentos de hasta 2000 caracteres se redacta; uno con un segmento de más de 2000 no se trata como JWT (se acotan los cuantificadores)', () => {
    assert.equal(redactarCredenciales(`eyJ${'a'.repeat(1_990)}.${'b'.repeat(1_990)}.${'c'.repeat(1_990)}`), '[jwt]')
    // Límite conocido: un segmento de más de 2000 caracteres no se reconoce como JWT (no es un formato real).
    assert.match(redactarCredenciales(`eyJ${'a'.repeat(2_500)}.bbbbbbbbbb.cccccccccc`), /^eyJa+\.bbbbbbbbbb\.cccccccccc$/)
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
      const piezas = secreto.split(/[\s=:/@?.]+/).filter((p) => p.length >= 6 && !['Bearer', 'Authorization', 'apikey'].includes(p))
      for (let relleno = 255; relleno <= 309; relleno++) {
        const salida = mensajeParaLog(`${'z'.repeat(relleno)} ${secreto} fin`, 300)
        assert.ok(salida.length <= 300)
        for (const p of piezas) for (const w of ventanas(p)) assert.equal(salida.includes(w), false, `relleno ${relleno}: queda «${w}» en ${salida.slice(-40)}`)
      }
    })
  }
})
