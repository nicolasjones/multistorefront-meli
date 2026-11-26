import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { esTimeoutDeProveedor, limiteDeCupo, rechazoPorCupo } from './cupo-ia.ts'
import { limpiarParaLog } from './log-seguro.ts'

const textos = { agotado: 'agotado' }
let logs: unknown[][]
let original: typeof console.error
beforeEach(() => { logs = []; original = console.error; console.error = (...a: unknown[]) => { logs.push(a) } })
afterEach(() => { console.error = original })
const admin = (resultado: { data: unknown; error: unknown }, llamadas: unknown[] = []) => ({
  rpc: (nombre: string, args: Record<string, unknown>) => { llamadas.push({ nombre, args }); return Promise.resolve(resultado) },
})

// Valores hostiles que pueden llegar a un `catch`: getters que lanzan, Proxy con `get` que lanza y Proxy revocado.
const hostiles = (): unknown[] => {
  const revocable = Proxy.revocable({}, {})
  revocable.revoke()
  return [{ get name() { throw new Error('getter name') } }, { get code() { throw new Error('getter code') } }, { get message() { throw new Error('getter message') } }, new Proxy({}, { get() { throw new Error('proxy get') } }), revocable.proxy]
}

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

  it('tacha todas las apariciones del id (dos, tres) y el uuid sin guiones, y acota el log a 300', async () => {
    for (const veces of [2, 3, 5]) {
      const log = await logDe(Array.from({ length: veces }, () => `id ${usuario}`).join(' / '))
      assert.equal((log.match(/\[usuario\]/g) ?? []).length, veces)
      for (const w of ventanas(usuario)) assert.equal(log.toLowerCase().includes(w), false)
    }
    for (const sinGuiones of [usuario.replaceAll('-', ''), usuario.replaceAll('-', '').toUpperCase(), otroUuid.replaceAll('-', '')]) {
      const log = await logDe(`Key (usuario_id)=(${sinGuiones}) y ${sinGuiones}`)
      assert.equal((log.match(/\[uuid\]|\[usuario\]/g) ?? []).length, 2, log)
      for (const w of [...ventanas(usuario.replaceAll('-', '')), ...ventanas(otroUuid.replaceAll('-', ''))]) assert.equal(log.toLowerCase().includes(w), false, `queda «${w}» en: ${log}`)
    }
    const largo = await logDe('k'.repeat(1000))
    assert.ok(largo.length <= 300 && largo.length > 250, `longitud ${largo.length}`)
  })

  it('con el recorte a 300 no queda ninguna ventana de 6 hex de ningún uuid, en 12 formatos y rellenos de 230 a 310', async () => {
    const formatos: Array<(u: string) => string> = [
      (u) => u, (u) => u.toUpperCase(), (u) => u.replaceAll('-', ''), (u) => u.replaceAll('-', '').toUpperCase(), (u) => `Key (usuario_id)=(${u})`,
      (u) => `"${u}"`, (u) => `'${u}'`, (u) => `id=${u};`, (u) => `abc${u.replaceAll('-', '')}def`, (u) => `${u} ${u}`, (u) => `[${u}]`, (u) => `x${u}x`,
    ]
    for (const formato of formatos) {
      for (let relleno = 230; relleno <= 310; relleno++) {
        const log = await logDe(`${'z'.repeat(relleno)} ${formato(usuario)} ${formato(otroUuid)}`)
        for (const w of [...ventanas(usuario), ...ventanas(otroUuid), ...ventanas(usuario.replaceAll('-', '')), ...ventanas(otroUuid.replaceAll('-', ''))]) {
          assert.equal(log.toLowerCase().includes(w), false, `relleno ${relleno}: queda «${w}»`)
        }
        assert.ok(log.length <= 300)
      }
    }
  })


  it('no destruye texto legítimo: hashes cortos, números y revisiones salen intactos', async () => {
    for (const texto of ['commit deadbeef', '0xdeadbeef', 'error 12345678', 'codigo 20240101', 'rev decade-faded', 'fallo en fedcba98']) {
      assert.equal(await logDe(texto), `23503 ${texto}`)
    }
  })


  it('uuid sin guiones pegado a letras hexadecimales de ambos lados: no queda ningún fragmento', async () => {
    const sin = usuario.replaceAll('-', '')
    for (const m of [`abc${sin}def`, `abc${sin}`, `${sin}def`, `fedcba${sin}abcdef012`, `abc${otroUuid.replaceAll('-', '')}def`]) {
      const log = await logDe(m)
      for (const w of [...ventanas(sin), ...ventanas(otroUuid.replaceAll('-', ''))]) assert.equal(log.toLowerCase().includes(w), false, `queda «${w}» en: ${log}`)
      assert.match(log, /\[uuid\]/)
    }
  })

  it('redacta credenciales y URLs del mensaje de la RPC (JWT, Bearer, x-api-key, apikey, sk-, URL con usuario y clave)', async () => {
    const secretos = ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c3VhcmlvIn0.firmaSECRETA123', 'Bearer abcSECRETO', 'Authorization: Bearer xSECRETO', 'x-api-key: kSECRETO', '?apikey=kSECRETO&x=1', 'sk-abcdefghijSECRETO0123', 'https://user:passSECRETO@host.example/ruta']
    for (const secreto of secretos) {
      const log = await logDe(`fallo de red ${secreto} fin`)
      assert.doesNotMatch(log, /SECRETO|firmaSECRETA|host\.example/, log)
    }
  })

  it('con un id de usuario vacío no se tacha «todo» (la regex vacía coincidiría en cada posición)', async () => {
    logs.length = 0
    await rechazoPorCupo(admin({ data: null, error: { code: 'XX000', message: 'fallo de base' } }), '', 'chat-ia', 30, textos)
    assert.equal((logs[0][1] as { error: string }).error, 'XX000 fallo de base')
  })

  it('el log es de UNA línea: sin saltos, controles, NUL ni separadores Unicode, y acotado', async () => {
    const log = await logDe('linea\n[cupo-ia] FAKE\r\n[otra] FAKE\u2028x\u2029y\u0000z\u0007w\u007fq')
    assert.equal(/[\r\n\u0000-\u001f\u007f\u2028\u2029]/.test(log), false)
    assert.match(log, /linea \[cupo-ia\] FAKE/)
    assert.equal(logs.length, 1)
    assert.ok((await logDe('x'.repeat(5000))).length <= 300)
  })

  it('describirError: cada lectura es segura por separado y conserva los demás campos', async () => {
    const lanza = () => { throw new Error('hostil') }
    const log = async (error: unknown) => {
      logs.length = 0
      await rechazoPorCupo(admin({ data: null, error }), usuario, 'chat-ia', 30, textos)
      return String((logs[0][1] as { error: string }).error)
    }
    assert.equal(await log({ name: 'N', code: 'C', message: 'M' }), 'N C M')
    assert.equal(await log({ get name() { return lanza() }, code: 'C', message: 'M' }), 'C M')
    assert.equal(await log({ name: 'N', get code() { return lanza() }, message: 'M' }), 'N M')
    assert.equal(await log({ name: 'N', code: 'C', get message() { return lanza() } }), 'N C')
  })

  it('regex lineales: 200k caracteres hostiles se procesan en menos de 1 s (mínimo de hasta 3 corridas)', async () => {
    const hostiles = ['a'.repeat(200_000), `${'a'.repeat(100_000)}@${'b'.repeat(100_000)}`, '1-'.repeat(100_000), `${'f'.repeat(199_999)}!`, `${usuario}-`.repeat(5_500), '@'.repeat(200_000)]
    for (const h of hostiles) {
      let mejor = Infinity
      for (let i = 0; i < 3 && mejor >= 1000; i++) {
        const t0 = performance.now()
        await logDe(h)
        limpiarParaLog(h, 64)
        mejor = Math.min(mejor, performance.now() - t0)
      }
      assert.ok(mejor < 1000, `tardó ${mejor} ms`)
    }
  })

  it('una excepción de red (TypeError con URL y clave) deja solo el nombre; el error que DEVUELVE la RPC deja su mensaje saneado', async () => {
    const red = new TypeError('fetch failed https://api.x/y?apikey=SEKRET Bearer SEKRET2', { cause: new Error('Bearer SEKRET3') })
    for (const a of [{ rpc: () => { throw red } }, { rpc: () => Promise.reject(red) }]) {
      logs.length = 0
      await rechazoPorCupo(a, usuario, 'chat-ia', 30, textos)
      assert.equal((logs[0][1] as { error: string }).error, 'TypeError')
      assert.doesNotMatch(JSON.stringify(logs), /SEKRET|api\.x|\[url\]|fetch failed/)
    }
    const devuelto = await logDe(`permission denied for table ia_cupo_uso (usuario ${usuario}) Bearer SEKRET`, '42501')
    assert.match(devuelto, /^42501 permission denied for table ia_cupo_uso \(usuario \[usuario\]\) Bearer \[token\]$/)
  })

  it('no registra nada cuando se consume o se agota el cupo (no son fallos)', async () => {
    await rechazoPorCupo(admin({ data: [{ se_consumio: true }], error: null }), usuario, 'f', 1, textos)
    await rechazoPorCupo(admin({ data: [{ se_consumio: false, segundos_hasta_reinicio: 5 }], error: null }), usuario, 'f', 1, textos)
    assert.deepEqual(logs, [])
  })
})

describe('rechazoPorCupo con valores hostiles', () => {
  it('una RPC que rechaza, lanza o devuelve un objeto hostil da 503 sin lanzar (error, excepción y respuesta)', async () => {
    const esperado = { status: 503, error: 'No se pudo verificar tu cuota de uso.' }
    const originalError = console.error
    const logs: unknown[][] = []
    console.error = (...a: unknown[]) => { logs.push(a) }
    try {
      for (const h of hostiles()) {
        assert.deepEqual(await rechazoPorCupo({ rpc: () => Promise.reject(h) }, 'u', 'f', 1, textos), esperado)
        assert.deepEqual(await rechazoPorCupo({ rpc: () => { throw h } }, 'u', 'f', 1, textos), esperado)
        assert.deepEqual(await rechazoPorCupo(admin({ data: null, error: h }), 'u', 'f', 1, textos), esperado)
        assert.deepEqual(await rechazoPorCupo(admin({ data: h, error: null }), 'u', 'f', 1, textos), esperado)
        assert.deepEqual(await rechazoPorCupo(admin({ data: [h], error: null }), 'u', 'f', 1, textos), esperado)
      }
    } finally { console.error = originalError }
    assert.ok(logs.length >= hostiles().length * 5)
    assert.ok(logs.every((l) => String(l[0]).startsWith('[cupo-ia]')))
  })
})

describe('bordes de las constantes de describirError (tabla)', () => {
  const rep = (c: string, n: number) => c.repeat(n)
  const hex31 = '0123456789abcdef0123456789abcde'
  // Texto de largo total `largo` cuyo último token ' visible' termina en el último caracter (relleno de 'z' dentro de una URL).
  const url2000 = (largo: number, resto = '') => `https://${rep('z', largo - 16)} visible${resto}`
  const filas: Array<{ nombre: string; mensaje: string; esperado: string }> = [
    // MAX_ERROR_LOG = 300 (código vacío para que el log sea solo el mensaje).
    { nombre: 'mensaje de 299', mensaje: rep('z', 299), esperado: rep('z', 299) },
    { nombre: 'mensaje de 300', mensaje: rep('z', 300), esperado: rep('z', 300) },
    { nombre: 'mensaje de 301', mensaje: rep('z', 301), esperado: rep('z', 300) },
    // MAX_ANTES_DE_TACHAR = 2000: una URL que colapsa 1900 caracteres a '[url]' deja ver el texto que sigue si cae dentro de los 2000.
    { nombre: 'entrada de 1999', mensaje: url2000(1999), esperado: '[url] visible' },
    { nombre: 'entrada de 2000', mensaje: url2000(2000), esperado: '[url] visible' },
    // Con 2001 el corte cae dentro de ' visible' (último token cortado): se descarta el token parcial y queda solo '[url]'.
    { nombre: 'entrada de 2001 (el último token queda cortado y se descarta)', mensaje: url2000(2001), esperado: '[url]' },
    { nombre: 'entrada de 2002 con un blanco justo en el corte: el último token está completo', mensaje: `${url2000(2000)} X`, esperado: '[url] visible' },
    // UUID sin guiones: 31 hexadecimales no se tachan; 32 y 33 sí.
    { nombre: '31 hex', mensaje: `id=${hex31}`, esperado: `id=${hex31}` },
    { nombre: '32 hex', mensaje: `id=${hex31}f`, esperado: 'id=[uuid]' },
    { nombre: '33 hex', mensaje: `id=${hex31}ff`, esperado: 'id=[uuid]' },
    // Correo: parte local {1,64} y dominio {1,255}.
    { nombre: 'local de 63', mensaje: `${rep('z', 63)}@d.com`, esperado: '[correo]' },
    { nombre: 'local de 64', mensaje: `${rep('z', 64)}@d.com`, esperado: '[correo]' },
    { nombre: 'local de 65', mensaje: `${rep('z', 65)}@d.com`, esperado: 'z[correo]' },
    { nombre: 'dominio de 254', mensaje: `u@${rep('z', 254)}`, esperado: '[correo]' },
    { nombre: 'dominio de 255', mensaje: `u@${rep('z', 255)}`, esperado: '[correo]' },
    { nombre: 'dominio de 256', mensaje: `u@${rep('z', 256)}`, esperado: '[correo]z' },
    // Correo: mínimos de la parte local y del dominio (1 y 1).
    { nombre: 'sin parte local', mensaje: '@d.com', esperado: '@d.com' },
    { nombre: 'sin dominio', mensaje: 'u@', esperado: 'u@' },
    { nombre: 'dominio mínimo de 1', mensaje: 'u@x', esperado: '[correo]' },
    // UUID con guiones: ceros en cada grupo, longitudes de los grupos de 8 y de 12 y negativos de 7 y de 11.
    { nombre: 'uuid todo ceros', mensaje: '00000000-0000-0000-0000-000000000000', esperado: '[uuid]' },
    { nombre: 'uuid con ceros solo en el grupo 1', mensaje: '00000000-1111-1111-1111-111111111111', esperado: '[uuid]' },
    { nombre: 'uuid con ceros solo en el grupo 2', mensaje: '11111111-0000-1111-1111-111111111111', esperado: '[uuid]' },
    { nombre: 'uuid con ceros solo en el grupo 3', mensaje: '11111111-1111-0000-1111-111111111111', esperado: '[uuid]' },
    { nombre: 'uuid con ceros solo en el grupo 4', mensaje: '11111111-1111-1111-0000-111111111111', esperado: '[uuid]' },
    { nombre: 'uuid con ceros solo en el grupo 5', mensaje: '11111111-1111-1111-1111-000000000000', esperado: '[uuid]' },
    { nombre: 'uuid entre letras (8 exactos y 12 exactos)', mensaje: 'a12345678-1234-1234-1234-123456789012b', esperado: 'a[uuid]b' },
    { nombre: 'uuid exacto sin nada alrededor', mensaje: '12345678-1234-1234-1234-123456789012', esperado: '[uuid]' },
    { nombre: 'grupo 1 de 7 no es uuid', mensaje: '1234567-1234-1234-1234-123456789012', esperado: '1234567-1234-1234-1234-123456789012' },
    { nombre: 'grupo 5 de 11 no es uuid', mensaje: '12345678-1234-1234-1234-12345678901', esperado: '12345678-1234-1234-1234-12345678901' },
  ]
  for (const { nombre, mensaje, esperado } of filas) {
    it(`describirError: ${nombre}`, async () => {
      logs.length = 0
      await rechazoPorCupo(admin({ data: null, error: { message: mensaje } }), 'usuario-x', 'chat-ia', 30, textos)
      assert.equal((logs[0][1] as { error: string }).error, esperado)
    })
  }

  it('un secreto que cruza el recorte previo de 2000 no deja su prefijo detrás de una URL larga (string y objeto de error)', async () => {
    const secretos = ['sk-A1b2C3d4E5f6G7h8I9j0K1l2M3n4', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c3VhcmlvIn0.firmaSECRETA1234567890', 'persona.prueba@example.com', '12345678-1234-4234-8234-123456789012', 'apikey=claveSECRETA1234567890']
    const ventanas = (secreto: string) => Array.from({ length: secreto.length - 5 }, (_, i) => secreto.slice(i, i + 6))
    for (const secreto of secretos) {
      for (const dentro of [3, 6, 7, 10]) {
        const mensaje = `http://${'a'.repeat(2000 - 7 - 1 - dentro)} ${secreto}`
        for (const error of [mensaje, { message: mensaje }]) {
          logs.length = 0
          await rechazoPorCupo(admin({ data: null, error }), 'usuario-x', 'chat-ia', 30, textos)
          const salida = (logs[0][1] as { error: string }).error
          for (const w of ventanas(secreto)) assert.equal(salida.includes(w), false, `queda «${w}» en ${salida}`)
          assert.equal(salida.startsWith('[url]'), true, salida)
        }
      }
    }
    // El caso exacto reportado: sale solo '[url]'.
    logs.length = 0
    await rechazoPorCupo(admin({ data: null, error: `http://${'a'.repeat(1985)} sk-A1b2C3d4E5f6G7h8I9j0K1l2M3n4` }), 'usuario-x', 'chat-ia', 30, textos)
    assert.equal((logs[0][1] as { error: string }).error, '[url]')
  })

  it('barrido: con el recorte previo en 2000, ningún largo de 1980 a 2010 deja un fragmento de 6 o más caracteres del secreto (string y objeto)', async () => {
    const secretos = [`sk-${'Abcdef1234'.repeat(3)}`, 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c3VhcmlvIn0.firmaSECRETA1234567890', 'persona.prueba@example.com', '12345678-1234-4234-8234-123456789012']
    const ventanas = (secreto: string) => Array.from({ length: secreto.length - 5 }, (_, i) => secreto.slice(i, i + 6))
    for (const secreto of secretos) {
      for (let L = 1980; L <= 2010; L++) {
        const mensaje = `http://h/${'a'.repeat(L - 9)} ${secreto}`
        for (const error of [mensaje, { message: mensaje }]) {
          logs.length = 0
          await rechazoPorCupo(admin({ data: null, error }), 'usuario-x', 'chat-ia', 30, textos)
          const salida = (logs[0][1] as { error: string }).error
          for (const w of ventanas(secreto)) assert.equal(salida.includes(w), false, `L=${L}: queda «${w}» en ${salida}`)
        }
      }
    }
  })

  it('un texto largo SIN blancos (3000 caracteres): pierde los últimos 64 del tramo previo y sale a 300', async () => {
    logs.length = 0
    await rechazoPorCupo(admin({ data: null, error: { message: 'z'.repeat(3000) } }), 'usuario-x', 'chat-ia', 30, textos)
    assert.equal((logs[0][1] as { error: string }).error, 'z'.repeat(300))
  })

  it('un error que es un string sigue el mismo orden (recorte con margen, redacción, recorte final): un secreto que cruza el 300 no deja prefijo', async () => {
    const log = async (error: string) => {
      logs.length = 0
      await rechazoPorCupo(admin({ data: null, error }), 'usuario-x', 'chat-ia', 30, textos)
      return (logs[0][1] as { error: string }).error
    }
    const clave = `${'z'.repeat(288)}sk-${'A'.repeat(10)}`
    const salida = await log(clave)
    assert.equal(salida, `${'z'.repeat(288)}[clave]`)
    for (let i = 0; i + 6 <= `sk-${'A'.repeat(10)}`.length; i++) assert.equal(salida.includes(`sk-${'A'.repeat(10)}`.slice(i, i + 6)), false)
    // La URL larga que sigue a un texto: con el largo total de 299, 300, 301 y 2000 siempre sale '[url] fin-visible'.
    for (const total of [299, 300, 301, 2000]) {
      const mensaje = `https://${'a'.repeat(total - 8 - 12)}${' fin-visible'}`
      assert.equal(mensaje.length, total)
      assert.equal(await log(mensaje), '[url] fin-visible', `total ${total}`)
    }
  })

  it('un error que no es objeto se acota a 300 (299/300/301)', async () => {
    for (const [largo, esperado] of [[299, 299], [300, 300], [301, 300]] as const) {
      logs.length = 0
      await rechazoPorCupo(admin({ data: null, error: rep('z', largo) }), 'usuario-x', 'chat-ia', 30, textos)
      assert.equal((logs[0][1] as { error: string }).error.length, esperado, `largo ${largo}`)
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
    for (const h of hostiles()) assert.doesNotThrow(() => esTimeoutDeProveedor(h))
  })
})
