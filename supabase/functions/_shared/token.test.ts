import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { esEntornoLocalExplicito, esEntornoProductivo, permitirTokenDebil, tokenDeEntorno, tokenValido } from './token.ts'

const fuerte = 'a'.repeat(40)

describe('tokenDeEntorno', () => {
  it('acepta un token largo', () => assert.equal(tokenDeEntorno(fuerte, undefined), fuerte))
  it('rechaza el valor de ejemplo, uno corto y el vacío', () => {
    assert.equal(tokenDeEntorno('change-me-local', undefined), undefined)
    assert.equal(tokenDeEntorno('change-me-local'.padEnd(40, 'x'), undefined), undefined)
    assert.equal(tokenDeEntorno('corto', undefined), undefined)
    assert.equal(tokenDeEntorno('', undefined), undefined)
    assert.equal(tokenDeEntorno(undefined, undefined), undefined)
  })
  it('en local, con la bandera explícita, deja pasar el valor de ejemplo', () => {
    assert.equal(tokenDeEntorno('change-me-local', 'true'), 'change-me-local')
    assert.equal(tokenDeEntorno('change-me-local', 'si'), undefined)
  })
})

const entorno = (vars: Record<string, string>) => (clave: string) => vars[clave]

describe('AVISOS_PERMITIR_TOKEN_DEBIL solo vale con marca local explícita', () => {
  it('con ENTORNO_LOCAL=1 (o ENVIRONMENT=local) y host local la bandera se aplica', () => {
    for (const marca of [{ ENTORNO_LOCAL: '1' }, { ENTORNO_LOCAL: 'true' }, { ENVIRONMENT: 'local' }]) {
      for (const url of ['http://kong:8000', 'http://127.0.0.1:54321', 'http://localhost:54321', undefined]) {
        const vars: Record<string, string> = { AVISOS_PERMITIR_TOKEN_DEBIL: 'true', ...marca }
        if (url) vars.SUPABASE_URL = url
        assert.equal(permitirTokenDebil(entorno(vars), () => assert.fail('no debe avisar en local')), 'true', `${JSON.stringify(marca)} ${url}`)
      }
    }
  })
  it('sin marca local (kong, localhost o nada) se IGNORA y avisa', () => {
    for (const url of ['http://kong:8000', 'http://localhost:54321', undefined]) {
      const avisos: string[] = []
      const vars: Record<string, string> = { AVISOS_PERMITIR_TOKEN_DEBIL: 'true' }
      if (url) vars.SUPABASE_URL = url
      assert.equal(permitirTokenDebil(entorno(vars), (t) => avisos.push(t)), undefined, String(url))
      assert.equal(avisos.length, 1)
    }
  })
  it('con otros valores de la marca se IGNORA', () => {
    for (const marca of [{ ENTORNO_LOCAL: '0' }, { ENTORNO_LOCAL: 'si' }, { ENTORNO_LOCAL: '' }, { ENVIRONMENT: 'dev' }]) {
      assert.equal(permitirTokenDebil(entorno({ AVISOS_PERMITIR_TOKEN_DEBIL: 'true', ...marca }), () => {}), undefined, JSON.stringify(marca))
    }
  })
  it('una señal productiva gana aunque la marca local esté puesta, y avisa sin datos', () => {
    for (const extra of [{ SUPABASE_URL: 'https://api.ejemplo.com' }, { API_EXTERNAL_URL: 'https://api.ejemplo.com' }, { APP_ENV: 'STG' }, { ENTORNO: 'production' }]) {
      const avisos: string[] = []
      const vars = { AVISOS_PERMITIR_TOKEN_DEBIL: 'true', ENTORNO_LOCAL: '1', ...extra }
      assert.equal(permitirTokenDebil(entorno(vars), (t) => avisos.push(t)), undefined, JSON.stringify(extra))
      assert.equal(avisos.length, 1)
      assert.doesNotMatch(avisos[0], /ejemplo\.com|production|STG|change-me/)
      // Con la bandera ignorada, el valor de ejemplo vuelve a rechazarse.
      assert.equal(tokenDeEntorno('change-me-local', permitirTokenDebil(entorno(vars), () => {})), undefined)
    }
  })
  it('sin la bandera no avisa ni cambia nada', () => {
    assert.equal(permitirTokenDebil(entorno({ SUPABASE_URL: 'https://api.ejemplo.com' }), () => assert.fail('sin bandera')), undefined)
    assert.equal(esEntornoProductivo(entorno({ SUPABASE_URL: 'no es una url' })), false)
    assert.equal(esEntornoProductivo(entorno({ SUPABASE_URL: 'http://kong:8000' })), false)
    assert.equal(esEntornoLocalExplicito(entorno({})), false)
  })
})

describe('tokenValido (comparación sin cortar por longitud)', () => {
  const esperado = 'a'.repeat(40)
  it('acepta solo el token igual', () => assert.equal(tokenValido(esperado, esperado), true))
  it('rechaza token corto, largo, distinto, vacío y ausente', () => {
    for (const recibido of ['a', 'a'.repeat(39), 'a'.repeat(41), 'b'.repeat(40), '', null, undefined]) assert.equal(tokenValido(esperado, recibido), false, String(recibido))
  })
  it('sin token configurado rechaza todo', () => {
    for (const recibido of [esperado, '', null]) assert.equal(tokenValido(undefined, recibido), false)
    assert.equal(tokenValido('', ''), false)
  })
})

describe('.env.example de las funciones', () => {
  const lineas = readFileSync(new URL('../.env.example', import.meta.url), 'utf8').split('\n').map((l) => l.trim())
  const leer = (clave: string) => lineas.find((l) => l.startsWith(`${clave}=`))?.slice(clave.length + 1)
  it('trae la bandera junto con la marca local (la bandera sola se ignoraría) y NO trae ENVIRONMENT', () => {
    assert.equal(leer('ENTORNO_LOCAL'), '1')
    assert.equal(leer('AVISOS_PERMITIR_TOKEN_DEBIL'), 'true')
    assert.equal(leer('ENVIRONMENT'), undefined)
  })
  it('con sus valores y SUPABASE_URL=http://kong:8000 la bandera se aplica (por eso no se copia a stg/prd, ver la doc)', () => {
    const env: Record<string, string> = { ENTORNO_LOCAL: '1', AVISOS_PERMITIR_TOKEN_DEBIL: 'true', SUPABASE_URL: 'http://kong:8000' }
    assert.equal(permitirTokenDebil((k) => env[k], () => {}), 'true')
  })
})
