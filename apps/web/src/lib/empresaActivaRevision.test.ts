import { describe, expect, it, vi } from 'vitest'
import { notificarEmpresaActivaCambiada, revisionEmpresaActiva, suscribirEmpresaActiva } from './empresaActivaRevision'

describe('empresaActivaRevision', () => {
  it('cada notificación avanza la revisión y avisa a los suscriptores', () => {
    const suscriptor = vi.fn()
    const inicial = revisionEmpresaActiva()
    const baja = suscribirEmpresaActiva(suscriptor)
    notificarEmpresaActivaCambiada()
    notificarEmpresaActivaCambiada()
    expect(revisionEmpresaActiva()).toBe(inicial + 2)
    expect(suscriptor).toHaveBeenCalledTimes(2)
    baja()
  })

  it('al darse de baja el suscriptor deja de recibir avisos pero la revisión sigue avanzando', () => {
    const suscriptor = vi.fn()
    const baja = suscribirEmpresaActiva(suscriptor)
    baja()
    const antes = revisionEmpresaActiva()
    notificarEmpresaActivaCambiada()
    expect(suscriptor).not.toHaveBeenCalled()
    expect(revisionEmpresaActiva()).toBe(antes + 1)
  })

  it('varios suscriptores reciben el mismo aviso', () => {
    const a = vi.fn()
    const b = vi.fn()
    const bajas = [suscribirEmpresaActiva(a), suscribirEmpresaActiva(b)]
    notificarEmpresaActivaCambiada()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
    bajas.forEach((baja) => baja())
  })
})
