import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@refinedev/core', () => ({ useGetIdentity: () => ({ data: { id: 'u-1' }, isLoading: false }) }))
vi.mock('../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { useReportesAsignados } from './useReportesAsignados'

describe('useReportesAsignados', () => {
  it('si la consulta falla deja de cargar y no devuelve reportes', async () => {
    mocks.rpc.mockReturnValue(Promise.reject(new Error('red caída')))
    const { result } = renderHook(() => useReportesAsignados())
    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.reportes).toEqual([])
  })
})
