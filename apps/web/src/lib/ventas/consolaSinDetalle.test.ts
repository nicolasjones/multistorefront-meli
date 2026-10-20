import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mensajeDeError as deEnvio } from './formasEnvio'
import { mensajeDeError as dePago } from './formasPago'
import { mensajeDeError as deTransporte } from './transportes'

describe('mensajeDeError: la consola no recibe el detalle de la fila', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined))

  it.each([
    ['formasEnvio', deEnvio],
    ['formasPago', dePago],
    ['transportes', deTransporte],
  ])('%s loguea solo el código', (_nombre, mensajeDeError) => {
    const cuit = '30712345678'
    mensajeDeError({ code: '23514', message: 'check violation', details: `Failing row contains (${cuit})` }, 'x')
    const llamadas = JSON.stringify(vi.mocked(console.error).mock.calls)
    expect(llamadas).not.toContain(cuit)
    expect(llamadas).toContain('23514')
  })
})
