import { renderHook, waitFor, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { schema: () => ({ rpc: mocks.rpc }) } }))

import { resolverEstadoTienda, useEstadoTienda } from './tiendaEstado'

const fila = {
  estado: 'pausada', nombre: 'Mundo JC', color_primario: '#AA1111', color_primario_oscuro: '#000000', color_acento: '#222222',
  color_fondo: '#FFFFFF', tipografia_titulos: 'Barlow Condensed', tipografia_texto: 'Barlow', logo_ruta: 'o/e/logo.png',
}

describe('resolverEstadoTienda (FR-001)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('traduce la marca de una tienda pausada', async () => {
    mocks.rpc.mockResolvedValue({ data: fila, error: null })
    expect(await resolverEstadoTienda('mundojc.localhost')).toEqual({
      nombre: 'Mundo JC', colorPrimario: '#AA1111', colorPrimarioOscuro: '#000000', colorAcento: '#222222', colorFondo: '#FFFFFF',
      tipografiaTitulos: 'Barlow Condensed', tipografiaTexto: 'Barlow', logoRuta: 'o/e/logo.png',
    })
    expect(mocks.rpc).toHaveBeenCalledWith('estado_tienda_por_dominio', { host: 'mundojc.localhost' })
  })

  it('devuelve null si no hay marca (desconocida o activa)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    expect(await resolverEstadoTienda('x.test')).toBeNull()
  })

  it('propaga el error de red', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'sin red' } })
    await expect(resolverEstadoTienda('x.test')).rejects.toThrow('sin red')
  })
})

describe('useEstadoTienda', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pasa de cargando a pausada', async () => {
    mocks.rpc.mockResolvedValue({ data: fila, error: null })
    const { result } = renderHook(() => useEstadoTienda('mundojc.localhost'))
    expect(result.current.estado).toEqual({ fase: 'cargando' })
    await waitFor(() => expect(result.current.estado.fase).toBe('pausada'))
  })

  it('pasa a desconocida cuando no hay marca', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    const { result } = renderHook(() => useEstadoTienda('x.test'))
    await waitFor(() => expect(result.current.estado).toEqual({ fase: 'desconocida' }))
  })

  it('ante un error queda en error y reintentar repite la consulta', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'sin red' } }).mockResolvedValueOnce({ data: fila, error: null })
    const { result } = renderHook(() => useEstadoTienda('mundojc.localhost'))
    await waitFor(() => expect(result.current.estado).toEqual({ fase: 'error' }))
    act(() => result.current.reintentar())
    await waitFor(() => expect(result.current.estado.fase).toBe('pausada'))
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
  })
})
