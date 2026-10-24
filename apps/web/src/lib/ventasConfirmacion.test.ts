import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabaseClient: { rpc: vi.fn() } }))

import { esFaltanteDeStock, mensajeDeConfirmacion, MENSAJE_ERROR_CONFIRMAR } from './ventasConfirmacion'

describe('esFaltanteDeStock', () => {
  it('reconoce P0001 con hint stock', () => {
    expect(esFaltanteDeStock({ code: 'P0001', hint: 'stock', message: 'No hay stock suficiente de X' })).toBe(true)
  })

  it('no toma por faltante un P0001 genérico de otra función', () => {
    const error = { code: 'P0001', message: 'error interno de registrar_actividad' }
    expect(esFaltanteDeStock(error)).toBe(false)
    expect(mensajeDeConfirmacion(error)).not.toContain('error interno')
    expect(mensajeDeConfirmacion(error)).toContain(MENSAJE_ERROR_CONFIRMAR.slice(0, 20))
  })
})
