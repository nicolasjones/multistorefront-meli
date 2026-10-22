import { describe, expect, it, vi } from 'vitest'
import {
  avisarCambioEmpresaActiva,
  suscribirCambioEmpresaActiva,
  versionActualEmpresaActiva,
} from './cambioEmpresaActiva'

describe('cambioEmpresaActiva', () => {
  it('sube la versión y avisa a los suscriptores', () => {
    const inicial = versionActualEmpresaActiva()
    const oyente = vi.fn()
    const desuscribir = suscribirCambioEmpresaActiva(oyente)
    avisarCambioEmpresaActiva()
    expect(versionActualEmpresaActiva()).toBe(inicial + 1)
    expect(oyente).toHaveBeenCalledTimes(1)
    desuscribir()
    avisarCambioEmpresaActiva()
    expect(oyente).toHaveBeenCalledTimes(1)
  })
})
