import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CLAVE_CONSENTIMIENTO,
  EVENTO_CONSENTIMIENTO,
  guardarConsentimiento,
  leerConsentimiento,
  reiniciarConsentimientoEnMemoria,
  useConsentimientoCookies,
} from './consentimientoCookies'

beforeEach(() => {
  window.localStorage.clear()
  reiniciarConsentimientoEnMemoria()
})
afterEach(() => vi.restoreAllMocks())

describe('consentimiento de cookies (FR-034)', () => {
  it('sin decisión devuelve null', () => {
    expect(leerConsentimiento()).toBeNull()
  })

  it('persiste la decisión en localStorage y la lee', () => {
    guardarConsentimiento('aceptadas')
    expect(window.localStorage.getItem(CLAVE_CONSENTIMIENTO)).toBe('aceptadas')
    expect(leerConsentimiento()).toBe('aceptadas')
    guardarConsentimiento('rechazadas')
    expect(leerConsentimiento()).toBe('rechazadas')
  })

  it('ignora un valor ajeno guardado', () => {
    window.localStorage.setItem(CLAVE_CONSENTIMIENTO, 'quizas')
    expect(leerConsentimiento()).toBeNull()
  })

  it('emite el evento de ventana con la decisión', () => {
    const oyente = vi.fn()
    window.addEventListener(EVENTO_CONSENTIMIENTO, oyente)
    guardarConsentimiento('rechazadas')
    window.removeEventListener(EVENTO_CONSENTIMIENTO, oyente)
    expect(oyente).toHaveBeenCalledTimes(1)
    expect((oyente.mock.calls[0]![0] as CustomEvent).detail).toBe('rechazadas')
  })

  it('el hook se actualiza al decidir', () => {
    const { result } = renderHook(() => useConsentimientoCookies())
    expect(result.current).toBeNull()
    act(() => guardarConsentimiento('aceptadas'))
    expect(result.current).toBe('aceptadas')
  })

  it('con localStorage bloqueado no rompe: lee null, guarda en memoria y avisa', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado') })
    expect(leerConsentimiento()).toBeNull()
    const { result } = renderHook(() => useConsentimientoCookies())
    expect(() => act(() => guardarConsentimiento('aceptadas'))).not.toThrow()
    expect(result.current).toBe('aceptadas')
  })
})
