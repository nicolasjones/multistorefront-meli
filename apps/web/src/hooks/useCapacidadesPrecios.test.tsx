import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ leer: vi.fn(), organizacion: vi.fn() }))

vi.mock('../lib/supabase', () => ({ supabaseClient: {} }))
vi.mock('../lib/capacidadesPrecios', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/capacidadesPrecios')>()),
  leerCapacidadesPrecios: mocks.leer,
}))
vi.mock('./useOrganizacionDeTrabajo', () => ({ useOrganizacionDeTrabajo: mocks.organizacion }))

import { useCapacidadesPrecios } from './useCapacidadesPrecios'

const ENCENDIDAS: { promociones: boolean; preciosMasivos: boolean; edicionEnTodasLasTiendas: boolean; nivelesProductos: Record<string, string> } = { promociones: true, preciosMasivos: true, edicionEnTodasLasTiendas: true, nivelesProductos: { e1: 'edicion' } }

function diferida<T>() {
  let resolver!: (valor: T) => void
  let rechazar!: (error: unknown) => void
  const promesa = new Promise<T>((res, rej) => { resolver = res; rechazar = rej })
  return { promesa, resolver, rechazar }
}

describe('useCapacidadesPrecios (MSF-363)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.organizacion.mockReturnValue({ organizacionId: 'o1', isLoading: false })
  })

  it('carga las capacidades y deja de cargar', async () => {
    mocks.leer.mockResolvedValue(ENCENDIDAS)
    const { result } = renderHook(() => useCapacidadesPrecios())
    expect(result.current.cargando).toBe(true)
    expect(result.current.capacidades.preciosMasivos).toBe(false)
    await waitFor(() => expect(result.current.cargando).toBe(false))
    expect(result.current.capacidades).toEqual(ENCENDIDAS)
    expect(result.current.hayError).toBe(false)
  })

  it('si la lectura falla, falla cerrado: todo apagado y hayError', async () => {
    mocks.leer.mockRejectedValue({ code: '500' })
    const { result } = renderHook(() => useCapacidadesPrecios())
    await waitFor(() => expect(result.current.cargando).toBe(false))
    expect(result.current.hayError).toBe(true)
    expect(result.current.capacidades).toEqual({ promociones: false, preciosMasivos: false, edicionEnTodasLasTiendas: false, nivelesProductos: {} })
  })

  it('al cambiar de organización apaga lo anterior de inmediato y no deja que una respuesta tardía de la anterior pise la actual', async () => {
    const primera = diferida<typeof ENCENDIDAS>()
    const segunda = diferida<typeof ENCENDIDAS>()
    mocks.leer.mockReturnValueOnce(primera.promesa).mockReturnValueOnce(segunda.promesa)
    const { result, rerender } = renderHook(() => useCapacidadesPrecios())

    mocks.organizacion.mockReturnValue({ organizacionId: 'o2', isLoading: false })
    rerender()
    expect(result.current.cargando).toBe(true)
    expect(result.current.capacidades.promociones).toBe(false)

    await act(async () => { segunda.resolver({ ...ENCENDIDAS, promociones: false, nivelesProductos: { e9: 'lectura' } }) })
    await waitFor(() => expect(result.current.cargando).toBe(false))
    // La respuesta tardía de la organización anterior se descarta.
    await act(async () => { primera.resolver(ENCENDIDAS) })
    expect(result.current.capacidades.nivelesProductos).toEqual({ e9: 'lectura' })
    expect(result.current.capacidades.promociones).toBe(false)
  })

  it('un error tardío de la petición anterior tampoco pisa la actual', async () => {
    const primera = diferida<typeof ENCENDIDAS>()
    mocks.leer.mockReturnValueOnce(primera.promesa).mockResolvedValueOnce(ENCENDIDAS)
    const { result, rerender } = renderHook(() => useCapacidadesPrecios())
    mocks.organizacion.mockReturnValue({ organizacionId: 'o2', isLoading: false })
    rerender()
    await waitFor(() => expect(result.current.cargando).toBe(false))
    await act(async () => { primera.rechazar(new Error('tarde')) })
    expect(result.current.hayError).toBe(false)
    expect(result.current.capacidades).toEqual(ENCENDIDAS)
  })
})
