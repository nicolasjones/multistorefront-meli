import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { crearLimitador, enteroPositivo } from './limite-memoria.ts'

describe('crearLimitador', () => {
  it('corta al llegar al máximo por clave y libera al vencer la ventana', () => {
    let t = 0
    const l = crearLimitador({ max: 2, ventanaMs: 1000, ahora: () => t })
    assert.equal(l.consumir('a'), true)
    assert.equal(l.consumir('a'), true)
    assert.equal(l.consumir('a'), false)
    assert.equal(l.consumir('b'), true)
    t = 1001
    assert.equal(l.consumir('a'), true)
  })
  it('acota la memoria con muchas claves', () => {
    const l = crearLimitador({ max: 1, ventanaMs: 10_000, maxClaves: 3, ahora: () => 0 })
    for (let i = 0; i < 10; i++) l.consumir(`k${i}`)
    assert.equal(l.consumir('k9'), false)
  })
  it('enteroPositivo valida la configuración', () => {
    assert.equal(enteroPositivo('5', 1), 5)
    assert.equal(enteroPositivo('x', 7), 7)
    assert.equal(enteroPositivo('0', 7), 7)
  })
})
