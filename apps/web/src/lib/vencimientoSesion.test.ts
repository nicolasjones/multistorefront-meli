import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CLAVE_MANTENER_SESION,
  INACTIVIDAD_MAXIMA_MS,
  limpiarRastroDeSesion,
  CLAVE_ULTIMA_ACTIVIDAD,
  registrarActividad,
  seguirActividad,
  sesionVencidaPorInactividad,
} from './vencimientoSesion'

describe('vencimientoSesion', () => {
  beforeEach(() => localStorage.clear())

  it('no vence sin actividad registrada ni dentro de las 12 h', () => {
    expect(sesionVencidaPorInactividad()).toBe(false)
    registrarActividad(1000)
    expect(sesionVencidaPorInactividad(1000 + INACTIVIDAD_MAXIMA_MS)).toBe(false)
  })

  it('vence pasadas 12 h de inactividad', () => {
    registrarActividad(1000)
    expect(sesionVencidaPorInactividad(1000 + INACTIVIDAD_MAXIMA_MS + 1)).toBe(true)
  })

  it('con «Mantener la sesión iniciada» no vence por inactividad', () => {
    localStorage.setItem(CLAVE_MANTENER_SESION, 'true')
    registrarActividad(1000)
    expect(sesionVencidaPorInactividad(1000 + 2 * INACTIVIDAD_MAXIMA_MS)).toBe(false)
  })

  it('limpiar borra el rastro de la sesión', () => {
    registrarActividad(1000)
    limpiarRastroDeSesion()
    expect(sesionVencidaPorInactividad(1000 + 2 * INACTIVIDAD_MAXIMA_MS)).toBe(false)
  })

  it('un clic tras >12 h de inactividad no renueva la marca y avisa del vencimiento', () => {
    const vieja = Date.now() - INACTIVIDAD_MAXIMA_MS - 1000
    registrarActividad(vieja)
    const alVencer = vi.fn()
    const detener = seguirActividad(alVencer)
    window.dispatchEvent(new Event('pointerdown'))
    detener()
    expect(alVencer).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(CLAVE_ULTIMA_ACTIVIDAD)).toBe(String(vieja))
    expect(sesionVencidaPorInactividad()).toBe(true)
  })

  it('un clic con actividad reciente renueva la marca sin avisar', () => {
    registrarActividad(Date.now() - 60 * 60 * 1000)
    const alVencer = vi.fn()
    const detener = seguirActividad(alVencer)
    window.dispatchEvent(new Event('keydown'))
    detener()
    expect(alVencer).not.toHaveBeenCalled()
    expect(Date.now() - Number(localStorage.getItem(CLAVE_ULTIMA_ACTIVIDAD))).toBeLessThan(5000)
  })
})
