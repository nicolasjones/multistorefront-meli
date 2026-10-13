import { beforeEach, describe, expect, it } from 'vitest'
import {
  getMantenerSesion,
  migrarSesionLegacy,
  almacenSesionAdapter,
  setMantenerSesion,
  supabaseClient,
} from './supabase'

describe('migrarSesionLegacy', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('una sesión previa en localStorage sin marca fija la marca y el refresh no la mueve', () => {
    window.localStorage.setItem('sb-x-auth-token', 'a')
    migrarSesionLegacy()
    expect(getMantenerSesion()).toBe(true)
    almacenSesionAdapter.setItem('sb-x-auth-token', 'b')
    expect(window.localStorage.getItem('sb-x-auth-token')).toBe('b')
    expect(window.sessionStorage.getItem('sb-x-auth-token')).toBeNull()
  })

  it('sin sesión en localStorage no fija la marca', () => {
    migrarSesionLegacy()
    expect(getMantenerSesion()).toBe(false)
  })

  it('con la sesión de pestaña en sessionStorage no fija la marca', () => {
    window.localStorage.setItem('sb-x-auth-token', 'a')
    window.sessionStorage.setItem('sb-x-auth-token', 'a')
    migrarSesionLegacy()
    expect(getMantenerSesion()).toBe(false)
  })
})

describe('almacenSesionAdapter («Mantener la sesión iniciada», F-ACC-01 FR-005)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('sin la casilla guarda la sesión solo en sessionStorage', () => {
    setMantenerSesion(false)
    almacenSesionAdapter.setItem('sb-token', 'a')

    expect(window.sessionStorage.getItem('sb-token')).toBe('a')
    expect(window.localStorage.getItem('sb-token')).toBeNull()
  })

  it('con la casilla guarda la sesión solo en localStorage', () => {
    setMantenerSesion(true)
    almacenSesionAdapter.setItem('sb-token', 'a')

    expect(window.localStorage.getItem('sb-token')).toBe('a')
    expect(window.sessionStorage.getItem('sb-token')).toBeNull()
  })

  it('migra entre almacenes sin dejar la sesión duplicada', () => {
    setMantenerSesion(false)
    almacenSesionAdapter.setItem('sb-token', 'a')
    setMantenerSesion(true)
    almacenSesionAdapter.setItem('sb-token', 'b')

    expect(window.localStorage.getItem('sb-token')).toBe('b')
    expect(window.sessionStorage.getItem('sb-token')).toBeNull()

    setMantenerSesion(false)
    almacenSesionAdapter.setItem('sb-token', 'c')

    expect(window.sessionStorage.getItem('sb-token')).toBe('c')
    expect(window.localStorage.getItem('sb-token')).toBeNull()
  })

  it('getItem lee de cualquiera de los dos y removeItem limpia ambos', () => {
    window.localStorage.setItem('sb-token', 'l')
    expect(almacenSesionAdapter.getItem('sb-token')).toBe('l')

    window.sessionStorage.setItem('sb-token', 's')
    almacenSesionAdapter.removeItem('sb-token')

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
