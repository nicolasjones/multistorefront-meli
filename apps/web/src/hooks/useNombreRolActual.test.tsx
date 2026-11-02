import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useNombreRolActual } from './useNombreRolActual'

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), maybeSingle: vi.fn(), eq: vi.fn() }))

vi.mock('./useOrganizacionDeTrabajo', () => ({ useOrganizacionDeTrabajo: () => ({ organizacionId: 'org-1', isLoading: false }) }))
vi.mock('../lib/supabase', () => ({
  supabaseClient: {
    auth: { getUser: mocks.getUser },
    from: () => {
      const cadena = { select: () => cadena, eq: (...args: unknown[]) => { mocks.eq(...args); return cadena }, maybeSingle: mocks.maybeSingle }
      return cadena
    },
  },
}))

describe('useNombreRolActual (MSF-637)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'u-1' } } })
  })

  it('devuelve el nombre visible del rol de la organización de trabajo', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { rol_id: 'operador' }, error: null })
    const { result } = renderHook(() => useNombreRolActual(true))
    await waitFor(() => expect(result.current).toBe('Operador'))
    expect(mocks.eq).toHaveBeenCalledWith('organizacion_id', 'org-1')
  })

  it.each([
    ['la consulta devuelve error', () => mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: 'x' } })],
    ['la consulta se rechaza', () => mocks.maybeSingle.mockRejectedValue(new Error('red'))],
    ['el rol es desconocido', () => mocks.maybeSingle.mockResolvedValue({ data: { rol_id: 'nuevo' }, error: null })],
  ])('si %s cae al genérico', async (_caso, preparar) => {
    preparar()
    const { result } = renderHook(() => useNombreRolActual(true))
    await waitFor(() => expect(mocks.maybeSingle).toHaveBeenCalled())
    expect(result.current).toBe('actual')
  })

  it('no consulta mientras no está activo', () => {
    renderHook(() => useNombreRolActual(false))
    expect(mocks.getUser).not.toHaveBeenCalled()
  })
})
