import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ regla: vi.fn(), rpc: vi.fn() }))

vi.mock('../lib/supabase', () => ({
  supabaseClient: {
    schema: () => ({ from: () => ({ select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: () => mocks.regla(id) }) }) }) }),
    rpc: (nombre: string, args: unknown) => {
      const resultado = mocks.rpc(nombre, args)
      return { single: () => resultado, then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(resultado).then(ok, ko) }
    },
  },
}))

import { usePreciosEmpresa, usePrevisualizacionPrecios } from './usePreciosEmpresa'

const regla = (ajuste: number) => ({ data: { base: 'central_ajuste', ajuste_pct: ajuste, updated_at: 'ts' }, error: null })

describe('usePreciosEmpresa', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('sin fila guardada la empresa es «Igual al central»', async () => {
    mocks.regla.mockResolvedValue({ data: null, error: null })
    const { result } = renderHook(() => usePreciosEmpresa('e-1'))
    await waitFor(() => expect(result.current.regla).toEqual({ base: 'central', ajustePct: 0, actualizadoEn: null }))
  })

  it('al cambiar de empresa descarta la regla anterior hasta leer la nueva', async () => {
    mocks.regla.mockImplementation((id: string) => Promise.resolve(regla(id === 'e-1' ? 8 : -5)))
    const { result, rerender } = renderHook(({ id }) => usePreciosEmpresa(id), { initialProps: { id: 'e-1' } })
    await waitFor(() => expect(result.current.regla?.ajustePct).toBe(8))

    rerender({ id: 'e-2' })
    expect(result.current.regla).toBeNull()
    await waitFor(() => expect(result.current.regla?.ajustePct).toBe(-5))
  })

  it('una lectura tardía de la empresa anterior no pisa a la actual', async () => {
    let resolverViejo: (v: unknown) => void = () => {}
    mocks.regla.mockImplementation((id: string) => (id === 'e-1' ? new Promise((r) => { resolverViejo = r }) : Promise.resolve(regla(-5))))
    const { result, rerender } = renderHook(({ id }) => usePreciosEmpresa(id), { initialProps: { id: 'e-1' } })
    rerender({ id: 'e-2' })
    await waitFor(() => expect(result.current.regla?.ajustePct).toBe(-5))
    await act(async () => resolverViejo(regla(8)))
    expect(result.current.regla?.ajustePct).toBe(-5)
  })

  it('un error de lectura queda en hayError y no se asume ninguna regla', async () => {
    mocks.regla.mockResolvedValue({ data: null, error: { code: 'XX000' } })
    const { result } = renderHook(() => usePreciosEmpresa('e-1'))
    await waitFor(() => expect(result.current.hayError).toBe(true))
    expect(result.current.regla).toBeNull()
  })
})

describe('usePrevisualizacionPrecios', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('con un ajuste inválido no consulta al servidor', async () => {
    const { result } = renderHook(() => usePrevisualizacionPrecios('e-1', 'central_ajuste', '-100', true))
    await new Promise((r) => setTimeout(r, 400))
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(result.current.filas).toBeNull()
  })

  it('con «Igual al central» consulta con ajuste 0 aunque el texto tenga otra cosa', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    renderHook(() => usePrevisualizacionPrecios('e-1', 'central', 'basura', true))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('previsualizar_precios_empresa', { p_empresa: 'e-1', p_base: 'central', p_ajuste_pct: 0 }))
  })

  it('un error del servidor queda en hayError', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
    const { result } = renderHook(() => usePrevisualizacionPrecios('e-1', 'central', '0', true))
    await waitFor(() => expect(result.current.hayError).toBe(true))
  })
})
