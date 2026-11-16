import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('../lib/supabase', () => ({ supabaseClient: { functions: { invoke } } }))

import { useCotizacionSugerida } from './useCotizacionSugerida'

describe('useCotizacionSugerida', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('devuelve la sugerida cuando la función responde bien', async () => {
    invoke.mockResolvedValue({ data: { valor: 1405.5, fuente: 'DolarApi', fecha: null }, error: null })
    const { result } = renderHook(() => useCotizacionSugerida(true))
    expect(result.current.estado).toBe('cargando')
    await waitFor(() => expect(result.current.estado).toBe('lista'))
    expect(invoke).toHaveBeenCalledWith('cotizacion-sugerida', { method: 'POST' })
  })

  it('queda no_disponible si hay error, datos inválidos o la llamada lanza', async () => {
    for (const respuesta of [{ data: null, error: new Error('x') }, { data: { valor: 'a', fuente: 'f', fecha: null }, error: null }]) {
      invoke.mockResolvedValueOnce(respuesta)
      const { result } = renderHook(() => useCotizacionSugerida(true))
      await waitFor(() => expect(result.current.estado).toBe('no_disponible'))
    }
    invoke.mockRejectedValueOnce(new Error('red'))
    const { result } = renderHook(() => useCotizacionSugerida(true))
    await waitFor(() => expect(result.current.estado).toBe('no_disponible'))
  })

  it('no consulta si no está habilitado', () => {
    renderHook(() => useCotizacionSugerida(false))
    expect(invoke).not.toHaveBeenCalled()
  })
})
