import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ sesionActivaEnTienda: vi.fn(), onAuthStateChange: vi.fn() }))
vi.mock('../lib/tiendaCuenta', async (original) => ({
  ...(await original<typeof import('../lib/tiendaCuenta')>()),
  sesionActivaEnTienda: mocks.sesionActivaEnTienda,
}))
vi.mock('../lib/supabase', () => ({ supabaseClient: { auth: { onAuthStateChange: mocks.onAuthStateChange } } }))

import { useSesionCliente, useSesionClienteDetallada } from './useSesionCliente'

const HOST = 'mundojc.localhost'
let oyentes: Array<(evento: string) => void> = []
const avisarAuth = (evento: string) => oyentes.forEach((oyente) => oyente(evento))

beforeEach(() => {
  vi.clearAllMocks()
  oyentes = []
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  mocks.onAuthStateChange.mockImplementation((callback: (evento: string) => void) => {
    oyentes.push(callback)
    return { data: { subscription: { unsubscribe: vi.fn() } } }
  })
  mocks.sesionActivaEnTienda.mockResolvedValue({ estado: 'activa', tipo: 'minorista' })
})

// Encabezado, menú y ficha preguntan lo mismo en la misma página: una sola consulta por host.
describe('useSesionCliente · sesión compartida por host', () => {
  it('tres usos montados a la vez hacen UNA sola consulta', async () => {
    const a = renderHook(() => useSesionCliente(HOST))
    const b = renderHook(() => useSesionCliente(HOST))
    const c = renderHook(() => useSesionClienteDetallada(HOST))
    await waitFor(() => expect(a.result.current).toBe('activa'))
    await waitFor(() => expect(b.result.current).toBe('activa'))
    await waitFor(() => expect(c.result.current.estado).toBe('activa'))
    expect(mocks.sesionActivaEnTienda).toHaveBeenCalledTimes(1)
  })

  it('un uso que se monta después, con otros todavía montados, reutiliza lo ya resuelto', async () => {
    const a = renderHook(() => useSesionCliente(HOST))
    await waitFor(() => expect(a.result.current).toBe('activa'))
    const b = renderHook(() => useSesionCliente(HOST))
    await waitFor(() => expect(b.result.current).toBe('activa'))
    expect(mocks.sesionActivaEnTienda).toHaveBeenCalledTimes(1)
  })

  it('sin nadie montado no queda nada guardado: el uso siguiente vuelve a preguntar', async () => {
    const a = renderHook(() => useSesionCliente(HOST))
    await waitFor(() => expect(a.result.current).toBe('activa'))
    a.unmount()
    const b = renderHook(() => useSesionCliente(HOST))
    await waitFor(() => expect(b.result.current).toBe('activa'))
    expect(mocks.sesionActivaEnTienda).toHaveBeenCalledTimes(2)
  })

  it('cada host tiene su propia consulta', async () => {
    const a = renderHook(() => useSesionCliente(HOST))
    const b = renderHook(() => useSesionCliente('sanjavucho.localhost'))
    await waitFor(() => expect(a.result.current).toBe('activa'))
    await waitFor(() => expect(b.result.current).toBe('activa'))
    expect(mocks.sesionActivaEnTienda).toHaveBeenCalledTimes(2)
  })

  it('un cambio de sesión de Auth vuelve a preguntar UNA vez para todos los usos y todos ven lo nuevo', async () => {
    const a = renderHook(() => useSesionClienteDetallada(HOST))
    const b = renderHook(() => useSesionClienteDetallada(HOST))
    await waitFor(() => expect(a.result.current.estado).toBe('activa'))
    mocks.sesionActivaEnTienda.mockClear()
    mocks.sesionActivaEnTienda.mockResolvedValue(null)
    act(() => { avisarAuth('SIGNED_OUT'); avisarAuth('SIGNED_OUT') })
    await waitFor(() => expect(a.result.current.estado).toBe('sin_sesion'))
    await waitFor(() => expect(b.result.current.estado).toBe('sin_sesion'))
    expect(mocks.sesionActivaEnTienda).toHaveBeenCalledTimes(1)
  })

  it('el contador de sesión sube con cada ingreso o salida y no con un refresco del token', async () => {
    const a = renderHook(() => useSesionClienteDetallada(HOST))
    await waitFor(() => expect(a.result.current.estado).toBe('activa'))
    const inicial = a.result.current.version
    act(() => avisarAuth('TOKEN_REFRESHED'))
    expect(a.result.current.version).toBe(inicial)
    act(() => avisarAuth('SIGNED_IN'))
    expect(a.result.current.version).toBe(inicial + 1)
    act(() => avisarAuth('SIGNED_OUT'))
    expect(a.result.current.version).toBe(inicial + 2)
  })

  it('INITIAL_SESSION (lo emite supabase-js al suscribirse) no dispara otra consulta', async () => {
    const a = renderHook(() => useSesionClienteDetallada(HOST))
    await waitFor(() => expect(a.result.current.estado).toBe('activa'))
    act(() => avisarAuth('INITIAL_SESSION'))
    await new Promise((resolver) => setTimeout(resolver, 20))
    expect(mocks.sesionActivaEnTienda).toHaveBeenCalledTimes(1)
    expect(a.result.current.version).toBe(0)
  })

  it('un fallo transitorio al volver a evaluar conserva el último estado conocido y solo marca `falla`', async () => {
    const a = renderHook(() => useSesionClienteDetallada(HOST))
    await waitFor(() => expect(a.result.current.estado).toBe('activa'))
    mocks.sesionActivaEnTienda.mockRejectedValueOnce(new Error('red'))
    act(() => avisarAuth('TOKEN_REFRESHED'))
    await waitFor(() => expect(a.result.current.falla).toBe(true))
    expect(a.result.current.estado).toBe('activa')
    mocks.sesionActivaEnTienda.mockResolvedValue(null)
    act(() => avisarAuth('SIGNED_OUT'))
    await waitFor(() => expect(a.result.current.estado).toBe('sin_sesion'))
    expect(a.result.current.falla).toBe(false)
  })

  it('una falla no se guarda: `falla` y reintentar vuelve a preguntar', async () => {
    mocks.sesionActivaEnTienda.mockRejectedValueOnce(new Error('red'))
    const a = renderHook(() => useSesionClienteDetallada(HOST))
    await waitFor(() => expect(a.result.current.falla).toBe(true))
    expect(a.result.current.estado).toBe('desconocida')
    act(() => a.result.current.reintentar())
    await waitFor(() => expect(a.result.current.estado).toBe('activa'))
    expect(a.result.current.falla).toBe(false)
    expect(mocks.sesionActivaEnTienda).toHaveBeenCalledTimes(2)
  })

  it('con activo = false no consulta', async () => {
    const a = renderHook(() => useSesionCliente(HOST, false))
    await new Promise((resolver) => setTimeout(resolver, 10))
    expect(a.result.current).toBe('desconocida')
    expect(mocks.sesionActivaEnTienda).not.toHaveBeenCalled()
  })
})
