import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSession = vi.hoisted(() => vi.fn())
const signOut = vi.hoisted(() => vi.fn())

vi.mock('../lib/supabase', () => ({
  supabaseClient: { auth: { getSession, signOut } },
}))

import { authProvider } from './authProvider'
import { CLAVE_ULTIMA_ACTIVIDAD, INACTIVIDAD_MAXIMA_MS } from '../lib/vencimientoSesion'

describe('authProvider: cierre y vencimiento de sesión', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
    signOut.mockResolvedValue({ error: null })
  })

  it('logout cierra la sesión y redirige al ingreso', async () => {
    const resultado = await authProvider.logout({})
    expect(signOut).toHaveBeenCalled()
    expect(resultado).toEqual({ success: true, redirectTo: '/login' })
  })

  it('check mantiene una sesión con actividad reciente', async () => {
    const resultado = await authProvider.check({})
    expect(resultado).toEqual({ authenticated: true })
  })

  it('check cierra la sesión tras 12 h de inactividad', async () => {
    localStorage.setItem(CLAVE_ULTIMA_ACTIVIDAD, String(Date.now() - INACTIVIDAD_MAXIMA_MS - 1000))
    const resultado = await authProvider.check({})
    expect(signOut).toHaveBeenCalled()
    expect(resultado).toMatchObject({ authenticated: false, redirectTo: '/login' })
  })

  it('check sin sesión limpia el rastro de actividad', async () => {
    localStorage.setItem(CLAVE_ULTIMA_ACTIVIDAD, String(Date.now()))
    getSession.mockResolvedValue({ data: { session: null }, error: null })
    const resultado = await authProvider.check({})
    expect(localStorage.getItem(CLAVE_ULTIMA_ACTIVIDAD)).toBeNull()
    expect(resultado).toEqual({ authenticated: false, redirectTo: '/login' })
  })

  it('check con sesión pero sin marca de actividad no la cierra y arranca el reloj', async () => {
    const resultado = await authProvider.check({})
    expect(signOut).not.toHaveBeenCalled()
    expect(resultado).toEqual({ authenticated: true })
    expect(localStorage.getItem(CLAVE_ULTIMA_ACTIVIDAD)).not.toBeNull()
  })

  it('check vencido cierra solo la sesión local si el cierre global falla', async () => {
    localStorage.setItem(CLAVE_ULTIMA_ACTIVIDAD, String(Date.now() - INACTIVIDAD_MAXIMA_MS - 1000))
    signOut.mockResolvedValueOnce({ error: { message: 'red' } })
    const resultado = await authProvider.check({})
    expect(signOut).toHaveBeenLastCalledWith({ scope: 'local' })
    expect(localStorage.getItem(CLAVE_ULTIMA_ACTIVIDAD)).toBeNull()
    expect(resultado).toMatchObject({ authenticated: false, redirectTo: '/login', logout: true })
  })
})
