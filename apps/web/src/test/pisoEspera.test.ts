import { describe, expect, it, vi } from 'vitest'
import { conPisoDeEspera } from './pisoEspera'

describe('conPisoDeEspera (piso de vi.waitFor)', () => {
  const llamar = (opciones?: Parameters<ReturnType<typeof conPisoDeEspera>>[1]) => {
    const original = vi.fn()
    conPisoDeEspera(original, 5000)(() => undefined, opciones)
    return original.mock.calls[0][1]
  }
  it('sin timeout propio rige el piso de 5 s', () => {
    expect(llamar()).toEqual({ timeout: 5000 })
    expect(llamar({ interval: 20 })).toEqual({ interval: 20, timeout: 5000 })
  })
  it('con timeout propio (objeto o número) lo respeta', () => {
    expect(llamar({ timeout: 300 })).toEqual({ timeout: 300 }) // 300 es el dato de entrada del test del wrapper, no una espera real
    expect(llamar(15000)).toEqual({ timeout: 15000 })
  })
  it('un timeout undefined explícito no pisa el piso (volvería al 1 s de vitest)', () => {
    expect(llamar({ timeout: undefined })).toEqual({ timeout: 5000 })
  })
  it('el setup instaló el piso en vi.waitFor global', async () => {
    let n = 0
    await vi.waitFor(() => { if (++n < 3) throw new Error('aún no') })
    expect(n).toBe(3)
  })
})
