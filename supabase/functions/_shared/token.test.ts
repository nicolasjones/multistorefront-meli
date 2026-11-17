import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { tokenDeEntorno } from './token.ts'

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
