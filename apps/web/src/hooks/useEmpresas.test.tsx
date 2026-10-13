import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resultado: vi.fn(),
  organizacionId: 'org-1' as string | null,
}))

vi.mock('./useOrganizacionActiva', () => ({
  useOrganizacionActiva: () => ({
    organizacionActiva: mocks.organizacionId ? { id: mocks.organizacionId } : null,
    isLoading: false,
  }),
}))
vi.mock('../lib/supabase', () => ({
  supabaseClient: {
    schema: () => ({
      from: () => ({ select: () => ({ order: () => ({ returns: mocks.resultado }) }) }),
    }),
  },
}))

import { useEmpresas } from './useEmpresas'

const empresa = (n: number) => ({ id: `e-${n}`, nombre: `Empresa ${n}`, activa: true })

// Captura cada render del hook: el efecto de carga corre dentro de `act`, así
// que solo registrando los renders se ve el intermedio previo a la carga.
function renderizarCapturando(props: { habilitado: boolean }) {
  const renders: Array<{ isLoading: boolean; empresas: number }> = []
  const vista = renderHook(
    (p: { habilitado: boolean }) => {
      const r = useEmpresas(p)
      renders.push({ isLoading: r.isLoading, empresas: r.empresas.length })
      return r
    },
    { initialProps: props },
  )
  return { ...vista, renders }
}

describe('useEmpresas', () => {
  beforeEach(() => {
    mocks.resultado.mockReset()
    mocks.organizacionId = 'org-1'
  })

  it('cuenta como cargando desde el primer render habilitado, antes de cualquier respuesta', async () => {
    mocks.resultado.mockResolvedValue({ data: [], error: null })
    const { renders, result } = renderizarCapturando({ habilitado: true })

    expect(renders[0].isLoading).toBe(true)
    await waitFor(() => expect(result.current.isLoading).toBe(false))
  })

  it('al habilitarse (permiso null → true) nunca renderiza un estado no cargando sin respuesta', async () => {
    mocks.resultado.mockResolvedValue({ data: [empresa(1)], error: null })
    const { renders, rerender, result } = renderizarCapturando({ habilitado: false })
    expect(result.current.isLoading).toBe(false)

    const antes = renders.length
    rerender({ habilitado: true })

    expect(renders[antes].isLoading).toBe(true)
    await waitFor(() => expect(result.current.empresas).toHaveLength(1))
    expect(renders.slice(antes).filter((r) => !r.isLoading && r.empresas === 0)).toHaveLength(0)
  })

  it('al cambiar de organización no pinta la lista de la anterior sin estado de carga', async () => {
    mocks.resultado.mockResolvedValueOnce({ data: [empresa(1)], error: null })
    const { renders, rerender, result } = renderizarCapturando({ habilitado: true })
    await waitFor(() => expect(result.current.empresas).toHaveLength(1))

    mocks.resultado.mockResolvedValueOnce({ data: [empresa(2), empresa(3)], error: null })
    mocks.organizacionId = 'org-2'
    const antes = renders.length
    rerender({ habilitado: true })

    expect(renders[antes].isLoading).toBe(true)
    await waitFor(() => expect(result.current.empresas).toHaveLength(2))
    expect(renders.slice(antes).some((r) => !r.isLoading && r.empresas === 1)).toBe(false)
  })

  it('si la consulta lanza una excepción termina en error y no queda cargando para siempre', async () => {
    mocks.resultado.mockRejectedValue(new Error('red caída'))
    const { result } = renderizarCapturando({ habilitado: true })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.isLoading).toBe(false)
    expect(result.current.empresas).toEqual([])
  })

  it('refetch vuelve a consultar', async () => {
    mocks.resultado.mockResolvedValue({ data: [], error: null })
    const { result } = renderizarCapturando({ habilitado: true })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.refetch()
    })
    expect(mocks.resultado).toHaveBeenCalledTimes(2)
  })
})
