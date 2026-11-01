import { beforeEach, describe, expect, it, vi } from 'vitest'

import { instalarVencimientoDeSesion } from './arranque'
import { CLAVE_ULTIMA_ACTIVIDAD } from './vencimientoSesion'

// El arranque decide por el host si instala el control de vencimiento por inactividad (MSF-673):
// en la tienda pública NO (no hay `/login` y el visitante no tiene sesión); en el panel, sí.
const PANEL = new Set(['panel.ejemplo.com'])

describe('instalarVencimientoDeSesion', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('[MSF-673] en un host de tienda no registra actividad ni avisa del vencimiento', () => {
    const vieja = Date.now() - 13 * 60 * 60 * 1000
    localStorage.setItem(CLAVE_ULTIMA_ACTIVIDAD, String(vieja))
    const alVencer = vi.fn()

    const detener = instalarVencimientoDeSesion('tienda.ejemplo.com', alVencer, PANEL)
    window.dispatchEvent(new Event('pointerdown'))
    window.dispatchEvent(new Event('keydown'))

    expect(detener).toBeUndefined()
    expect(alVencer).not.toHaveBeenCalled()
    // La marca no se renueva: en la tienda no hay sesión que vencer.
    expect(localStorage.getItem(CLAVE_ULTIMA_ACTIVIDAD)).toBe(String(vieja))
  })

  it('[MSF-673] en un host del panel avisa del vencimiento tras más de 12 h', () => {
    localStorage.setItem(CLAVE_ULTIMA_ACTIVIDAD, String(Date.now() - 13 * 60 * 60 * 1000))
    const alVencer = vi.fn()

    const detener = instalarVencimientoDeSesion('panel.ejemplo.com', alVencer, PANEL)
    window.dispatchEvent(new Event('pointerdown'))
    detener?.()

    expect(alVencer).toHaveBeenCalledTimes(1)
  })

  it('[MSF-673] en un host del panel con actividad reciente renueva la marca sin avisar', () => {
    localStorage.setItem(CLAVE_ULTIMA_ACTIVIDAD, String(Date.now() - 60 * 60 * 1000))
    const alVencer = vi.fn()

    const detener = instalarVencimientoDeSesion('panel.ejemplo.com', alVencer, PANEL)
    window.dispatchEvent(new Event('pointerdown'))
    detener?.()

    expect(alVencer).not.toHaveBeenCalled()
    expect(Number(localStorage.getItem(CLAVE_ULTIMA_ACTIVIDAD))).toBeGreaterThan(Date.now() - 60 * 60 * 1000)
  })
})
