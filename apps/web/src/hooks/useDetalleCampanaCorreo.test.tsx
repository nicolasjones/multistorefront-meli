import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))
vi.mock('./useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: { id: 'org-1' } }) }))

import { useDetalleCampanaCorreo } from './useHistorialCorreoMasivo'

const entrada = { campanaId: 'c-1', pagina: 1, tamano: 20 }

describe('useDetalleCampanaCorreo: campaña inexistente', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(['P0002', 'PT404'])('el código %s se informa como «no existe», no como error', async (code) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code } })
    const { result } = renderHook(() => useDetalleCampanaCorreo(entrada))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.noExiste).toBe(true)
    expect(result.current.isError).toBe(false)
    expect(result.current.datos).toBeNull()
  })

  it('otro código de error sí es error y no «no existe»', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
    const { result } = renderHook(() => useDetalleCampanaCorreo(entrada))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.noExiste).toBe(false)
    expect(result.current.isError).toBe(true)
  })
})
