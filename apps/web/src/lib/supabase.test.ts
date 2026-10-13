import { beforeEach, describe, expect, it } from 'vitest'
import { sessionStorageAdapter, setMantenerSesion, supabaseClient } from './supabase'

describe('sessionStorageAdapter («Mantener la sesión iniciada», F-ACC-01 FR-005)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('sin la casilla guarda la sesión solo en sessionStorage', () => {
    setMantenerSesion(false)
    sessionStorageAdapter.setItem('sb-token', 'a')

    expect(window.sessionStorage.getItem('sb-token')).toBe('a')
    expect(window.localStorage.getItem('sb-token')).toBeNull()
  })

  it('con la casilla guarda la sesión solo en localStorage', () => {
    setMantenerSesion(true)
    sessionStorageAdapter.setItem('sb-token', 'a')

    expect(window.localStorage.getItem('sb-token')).toBe('a')
    expect(window.sessionStorage.getItem('sb-token')).toBeNull()
  })

  it('migra entre almacenes sin dejar la sesión duplicada', () => {
    setMantenerSesion(false)
    sessionStorageAdapter.setItem('sb-token', 'a')
    setMantenerSesion(true)
    sessionStorageAdapter.setItem('sb-token', 'b')

    expect(window.localStorage.getItem('sb-token')).toBe('b')
    expect(window.sessionStorage.getItem('sb-token')).toBeNull()

    setMantenerSesion(false)
    sessionStorageAdapter.setItem('sb-token', 'c')

    expect(window.sessionStorage.getItem('sb-token')).toBe('c')
    expect(window.localStorage.getItem('sb-token')).toBeNull()
  })

  it('getItem lee de cualquiera de los dos y removeItem limpia ambos', () => {
    window.localStorage.setItem('sb-token', 'l')
    expect(sessionStorageAdapter.getItem('sb-token')).toBe('l')

    window.sessionStorage.setItem('sb-token', 's')
    sessionStorageAdapter.removeItem('sb-token')

    expect(window.localStorage.getItem('sb-token')).toBeNull()
    expect(window.sessionStorage.getItem('sb-token')).toBeNull()
  })

  it('setMantenerSesion(false) borra la marca persistida', () => {
    setMantenerSesion(true)
    setMantenerSesion(false)

    expect(window.localStorage.getItem('msf.mantener-sesion')).toBeNull()
  })

  it('la marca se borra al cerrarse la sesión por cualquier vía (SIGNED_OUT)', async () => {
    setMantenerSesion(true)

    await supabaseClient.auth.signOut()

    expect(window.localStorage.getItem('msf.mantener-sesion')).toBeNull()
  })
})
