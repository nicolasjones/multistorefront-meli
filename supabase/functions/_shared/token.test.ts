import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { tokenDeEntorno, tokenValido } from './token.ts'

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
