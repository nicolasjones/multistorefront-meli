import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  lectura: vi.fn(),
  escritura: vi.fn(),
  update: vi.fn(),
  eqUpdate: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabaseClient: {
    schema: () => ({
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: mocks.lectura }) }),
        update: (valores: unknown) => {
          mocks.update(valores)
          const encadenado = {
            eq: (columna: string, valor: unknown) => {
              mocks.eqUpdate(columna, valor)
              return encadenado
            },
            select: () => ({ maybeSingle: mocks.escritura }),
          }
          return encadenado
        },
      }),
    }),
  },
}))

import { useEmpresa } from './useEmpresa'

const base = { id: 'e-1', nombre: 'Uno', whatsapp: null, correo: null, instagram: null, direccion: null, horarios: null, activa: true }
const datos = { nombre: 'Nuevo', whatsapp: null, correo: null, instagram: null, direccion: null, horarios: null }

describe('useEmpresa', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.lectura.mockResolvedValue({ data: base, error: null })
  })

  it('cambiarEstado filtra por id y por el estado previo, y actualiza la empresa', async () => {
    mocks.escritura.mockResolvedValue({ data: { ...base, activa: false }, error: null })
    const { result } = renderHook(() => useEmpresa('e-1'))
    await waitFor(() => expect(result.current.empresa).not.toBeNull())

    await act(() => result.current.cambiarEstado(false))

    expect(mocks.update).toHaveBeenCalledWith({ activa: false })
    expect(mocks.eqUpdate).toHaveBeenCalledWith('id', 'e-1')
    expect(mocks.eqUpdate).toHaveBeenCalledWith('activa', true)
    expect(result.current.empresa?.activa).toBe(false)
  })

  it('cambiarEstado con cero filas lanza, recarga y no pisa el estado local', async () => {
    mocks.escritura.mockResolvedValue({ data: null, error: null })
    const { result } = renderHook(() => useEmpresa('e-1'))
    await waitFor(() => expect(result.current.empresa).not.toBeNull())

    await expect(act(() => result.current.cambiarEstado(false))).rejects.toThrow(/otra persona ya lo cambió/)

    await waitFor(() => expect(mocks.lectura).toHaveBeenCalledTimes(2))
  })

  it('cambiarEstado propaga el error de Supabase', async () => {
    mocks.escritura.mockResolvedValue({ data: null, error: new Error('permiso denegado') })
    const { result } = renderHook(() => useEmpresa('e-1'))
    await waitFor(() => expect(result.current.empresa).not.toBeNull())

    await expect(act(() => result.current.cambiarEstado(false))).rejects.toThrow('permiso denegado')
  })

  it('una respuesta tardía de cambiarEstado de otra empresa no pisa a la vigente', async () => {
    let resolver: (valor: unknown) => void = () => undefined
    mocks.escritura.mockReturnValue(new Promise((resolve) => (resolver = resolve)))
    const { result, rerender } = renderHook(({ id }) => useEmpresa(id), { initialProps: { id: 'e-1' } })
    await waitFor(() => expect(result.current.empresa?.id).toBe('e-1'))
    const pendiente = result.current.cambiarEstado(false)

    mocks.lectura.mockResolvedValue({ data: { ...base, id: 'e-2', nombre: 'Dos' }, error: null })
    rerender({ id: 'e-2' })
    await waitFor(() => expect(result.current.empresa?.id).toBe('e-2'))
    await act(async () => {
      resolver({ data: { ...base, activa: false }, error: null })
      await pendiente
    })

    expect(result.current.empresa?.id).toBe('e-2')
    expect(result.current.empresa?.activa).toBe(true)
  })

  it('una respuesta tardía de actualizar de otra empresa no pisa a la vigente', async () => {
    let resolver: (valor: unknown) => void = () => undefined
    mocks.escritura.mockReturnValue(new Promise((resolve) => (resolver = resolve)))
    const { result, rerender } = renderHook(({ id }) => useEmpresa(id), { initialProps: { id: 'e-1' } })
    await waitFor(() => expect(result.current.empresa?.id).toBe('e-1'))
    const pendiente = result.current.actualizar(datos)

    mocks.lectura.mockResolvedValue({ data: { ...base, id: 'e-2', nombre: 'Dos' }, error: null })
    rerender({ id: 'e-2' })
    await waitFor(() => expect(result.current.empresa?.id).toBe('e-2'))
    await act(async () => {
      resolver({ data: { ...base, nombre: 'Nuevo' }, error: null })
      await pendiente
    })

    expect(result.current.empresa).toMatchObject({ id: 'e-2', nombre: 'Dos' })
  })
})
