// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

async function cargar(url: string) {
  window.history.replaceState(null, '', url)
  vi.resetModules()
  return import('./enlaceAuth')
}

describe('enlaceAuth', () => {
  beforeEach(() => window.sessionStorage.clear())

  it('reconoce enlaces de recuperación/invitación y el código de PKCE', async () => {
    expect((await cargar('/definir-contrasena#access_token=a&type=recovery')).llegoPorEnlace()).toBe(true)
    window.sessionStorage.clear()
    expect((await cargar('/definir-contrasena#type=invite')).llegoPorEnlace()).toBe(true)
    window.sessionStorage.clear()
    expect((await cargar('/definir-contrasena?code=abc')).llegoPorEnlace()).toBe(true)
  })

  it('un `type` ajeno no habilita la pantalla', async () => {
    expect((await cargar('/definir-contrasena#type=otro')).llegoPorEnlace()).toBe(false)
  })

  it('olvidarEnlace borra la marca', async () => {
    const m = await cargar('/definir-contrasena?code=abc')
    m.olvidarEnlace()
    expect(m.llegoPorEnlace()).toBe(false)
  })
})
