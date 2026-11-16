import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// MSF-740: la regla de inactividad de sesión es del panel (12 h → cierre y `/login`). La tienda pública no la
// hereda: la sesión del cliente termina por salida explícita («Salir» de la tienda) o por el tope de 30 días del
// servidor. Estos casos fijan las dos ramas: en la tienda no hay control (ni cierre, ni redirección, ni marca de
// actividad) y en el panel la regla sigue igual que antes.
const mocks = vi.hoisted(() => ({ logout: vi.fn(), assign: vi.fn() }))

vi.mock('../providers/authProvider', () => ({ authProvider: { logout: mocks.logout } }))

import { instalarVencimientoDeSesion } from './arranqueSesion'
import { CLAVE_ULTIMA_ACTIVIDAD, INACTIVIDAD_MAXIMA_MS } from './vencimientoSesion'

describe('instalarVencimientoDeSesion', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.logout.mockReset()
    mocks.logout.mockResolvedValue({ success: true, redirectTo: '/login' })
    mocks.assign.mockReset()
    vi.stubGlobal('location', { ...window.location, assign: mocks.assign })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('en la tienda no cierra la sesión ni redirige al vencer', async () => {
    localStorage.setItem(CLAVE_ULTIMA_ACTIVIDAD, String(Date.now() - INACTIVIDAD_MAXIMA_MS - 1000))

    const detener = instalarVencimientoDeSesion(true)
    window.dispatchEvent(new Event('pointerdown'))
    await Promise.resolve()
    detener?.()

    expect(mocks.logout).not.toHaveBeenCalled()
    expect(mocks.assign).not.toHaveBeenCalled()
  })

  it('en la tienda no escribe la marca de actividad', () => {
    const detener = instalarVencimientoDeSesion(true)
    window.dispatchEvent(new Event('pointerdown'))
    detener?.()

    expect(localStorage.getItem(CLAVE_ULTIMA_ACTIVIDAD)).toBeNull()
  })

  it('en el panel cierra la sesión y vuelve a /login al vencer', async () => {
    localStorage.setItem(CLAVE_ULTIMA_ACTIVIDAD, String(Date.now() - INACTIVIDAD_MAXIMA_MS - 1000))

    const detener = instalarVencimientoDeSesion(false)
    window.dispatchEvent(new Event('pointerdown'))
    await Promise.resolve()
    await Promise.resolve()
    detener?.()

    expect(mocks.logout).toHaveBeenCalledTimes(1)
    expect(mocks.assign).toHaveBeenCalledWith('/login')
  })

  it('en el panel la actividad reciente renueva la marca y no cierra la sesión', () => {
    const detener = instalarVencimientoDeSesion(false)
    window.dispatchEvent(new Event('keydown'))
    detener?.()

    expect(mocks.logout).not.toHaveBeenCalled()
    expect(Date.now() - Number(localStorage.getItem(CLAVE_ULTIMA_ACTIVIDAD))).toBeLessThan(5 * 1000)
  })
})
