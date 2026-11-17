import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabaseClient: { from: vi.fn() } }))

import { formatearUltimoInteres, MENSAJE_ERROR_INTERES, mensajeDeErrorInteres } from './interesWhatsapp'

afterEach(() => vi.restoreAllMocks())

describe('interés por WhatsApp', () => {
  it('muestra el día en hora de Argentina, no el de UTC', () => {
    expect(formatearUltimoInteres('2026-11-17T15:00:00Z')).toBe('17/11/2026')
    expect(formatearUltimoInteres('2026-11-17T01:30:00Z')).toBe('16/11/2026')
  })

  it('el mensaje de error es siempre el de negocio, aunque el error traiga detalle técnico', () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(mensajeDeErrorInteres(new Error('relation "x" does not exist'))).toBe(MENSAJE_ERROR_INTERES)
    expect(consola).toHaveBeenCalledTimes(1)
    expect(mensajeDeErrorInteres('texto')).toBe(MENSAJE_ERROR_INTERES)
    expect(mensajeDeErrorInteres(null)).toBe(MENSAJE_ERROR_INTERES)
  })
})
