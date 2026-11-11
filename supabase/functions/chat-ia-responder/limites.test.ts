// F-IA-01 · FR-023: el chat nunca entrega más de 50 filas al modelo y avisa cuando recorta.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { acotarFilas, TOPE_FILAS_CONSULTA } from './limites.ts'

const filas = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }))

describe('acotarFilas (tope de consulta del asistente)', () => {
  it('el tope es de 50 filas', () => {
    assert.equal(TOPE_FILAS_CONSULTA, 50)
  })

  it('con 50 filas o menos devuelve todo y no avisa', () => {
    for (const n of [0, 1, 49, 50]) {
      const r = acotarFilas(filas(n))
      assert.equal(r.filas.length, n)
      assert.equal(r.truncado, false)
      assert.equal(r.aviso, undefined)
    }
  })

  it('con 51 filas (la de más que trae la lectura) devuelve 50, marca truncado y trae un aviso claro', () => {
    const r = acotarFilas(filas(51))
    assert.equal(r.filas.length, 50)
    assert.equal(r.truncado, true)
    assert.deepEqual(r.filas[49], { id: 50 })
    assert.match(r.aviso ?? '', /más de 50 resultados/)
  })

  it('con muchas más filas igual devuelve 50 y no entrega las demás', () => {
    const r = acotarFilas(filas(500))
    assert.equal(r.filas.length, 50)
    assert.equal(r.filas.some((f) => f.id > 50), false)
  })

  it('sin datos (null o undefined) devuelve una lista vacía', () => {
    assert.deepEqual(acotarFilas(null), { filas: [], truncado: false })
    assert.deepEqual(acotarFilas(undefined), { filas: [], truncado: false })
  })

  it('respeta un tope distinto si se pide', () => {
    const r = acotarFilas(filas(5), 3)
    assert.equal(r.filas.length, 3)
    assert.equal(r.truncado, true)
  })
})
