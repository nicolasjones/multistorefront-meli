import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { rechazoPorFuncionalidad } from './acceso-ia.ts'

const textos = { noHabilitada: 'no habilitada', noVerificable: 'no verificable' }

describe('rechazoPorFuncionalidad', () => {
  it('deja pasar solo con la funcionalidad habilitada', () => {
    assert.equal(rechazoPorFuncionalidad({ data: true, error: null }, textos), null)
  })
  it('403 si la organización no la tiene (false, null o cualquier valor que no sea true)', () => {
    for (const data of [false, null, undefined, 'true', 1]) assert.deepEqual(rechazoPorFuncionalidad({ data, error: null }, textos), { status: 403, error: 'no habilitada' })
  })
  it('503 si la verificación falla, aunque data venga en true: no se gasta crédito', () => {
    assert.deepEqual(rechazoPorFuncionalidad({ data: true, error: { message: 'x' } }, textos), { status: 503, error: 'no verificable' })
  })
})
