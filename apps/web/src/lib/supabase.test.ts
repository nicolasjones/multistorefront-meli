import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

    expect(window.localStorage.getItem('sesion:mantener')).toBeNull()
  })

  it('la marca se borra al cerrarse la sesión por cualquier vía (SIGNED_OUT)', async () => {
    setMantenerSesion(true)

    await supabaseClient.auth.signOut()

    expect(window.localStorage.getItem('sesion:mantener')).toBeNull()
  })
})

describe('storage bloqueado por el navegador', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })
  afterEach(() => vi.restoreAllMocks())

  it('leer y escribir la marca no lanza y migrarSesionLegacy tolera el SecurityError', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('bloqueado', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('bloqueado', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('bloqueado', 'SecurityError')
    })

    expect(getMantenerSesion()).toBe(false)
    expect(() => setMantenerSesion(true)).not.toThrow()
    expect(() => setMantenerSesion(false)).not.toThrow()
    expect(() => migrarSesionLegacy()).not.toThrow()
  })

  const bloqueo = () => {
    throw new DOMException('bloqueado', 'SecurityError')
  }

  // Storage es un objeto de propiedades nombradas en jsdom: se espía el prototipo
  // y se decide por `this` qué almacén falla.
  function bloquear(cual: 'sessionStorage' | 'localStorage') {
    const bloqueado = window[cual]
    for (const metodo of ['getItem', 'setItem', 'removeItem'] as const) {
      const original = Storage.prototype[metodo] as (this: Storage, ...a: string[]) => unknown
      vi.spyOn(Storage.prototype, metodo).mockImplementation(function (this: Storage, ...a: string[]) {
        if (this === bloqueado) return bloqueo()
        return original.apply(this, a)
      } as never)
    }
  }

  it('con sessionStorage bloqueado el adaptador lee y escribe en localStorage sin lanzar', () => {
    window.localStorage.setItem('sb-x-auth-token', 'tok')
    window.localStorage.setItem('sesion:mantener', 'true')
    bloquear('sessionStorage')

    expect(almacenSesionAdapter.getItem('sb-x-auth-token')).toBe('tok')
    expect(() => almacenSesionAdapter.setItem('sb-x-auth-token', 'nuevo')).not.toThrow()
    expect(window.localStorage.getItem('sb-x-auth-token')).toBe('nuevo')
    expect(() => almacenSesionAdapter.removeItem('sb-x-auth-token')).not.toThrow()
    expect(window.localStorage.getItem('sb-x-auth-token')).toBeNull()
  })

  it('con localStorage bloqueado el adaptador usa sessionStorage sin lanzar', () => {
    window.sessionStorage.setItem('sb-x-auth-token', 'tok')
    bloquear('localStorage')

    expect(almacenSesionAdapter.getItem('sb-x-auth-token')).toBe('tok')
    expect(() => almacenSesionAdapter.setItem('sb-x-auth-token', 'nuevo')).not.toThrow()
    expect(window.sessionStorage.getItem('sb-x-auth-token')).toBe('nuevo')
    expect(() => almacenSesionAdapter.removeItem('sb-x-auth-token')).not.toThrow()
    expect(window.sessionStorage.getItem('sb-x-auth-token')).toBeNull()
  })

  it('si la escritura en el destino falla, el token anterior del otro almacén se conserva', () => {
    window.localStorage.setItem('sb-x-auth-token', 'viejo')
    // sin marca: el destino es sessionStorage, y su escritura falla (cuota)
    bloquear('sessionStorage')

    expect(() => almacenSesionAdapter.setItem('sb-x-auth-token', 'nuevo')).not.toThrow()
    expect(window.localStorage.getItem('sb-x-auth-token')).toBe('viejo')
  })
})
