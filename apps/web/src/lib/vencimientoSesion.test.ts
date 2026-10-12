import { beforeEach, describe, expect, it } from 'vitest'
import {
  CLAVE_MANTENER_SESION,
  INACTIVIDAD_MAXIMA_MS,
  limpiarRastroDeSesion,
  registrarActividad,
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
})
