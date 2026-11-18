import { describe, expect, it } from 'vitest'
import { modoVideo } from '../fixture'

describe('modoVideo (E2E_VIDEO_CONTEXTOS)', () => {
  it('por defecto graba completo, como siempre', () => {
    expect(modoVideo(undefined)).toBe('completa')
    expect(modoVideo('')).toBe('completa')
  })
  it('acepta baja y off', () => {
    expect(modoVideo('baja')).toBe('baja')
    expect(modoVideo('off')).toBe('off')
  })
  it('un valor desconocido lanza en vez de grabar a ciegas', () => {
    expect(() => modoVideo('hd')).toThrow(/E2E_VIDEO_CONTEXTOS inválido/)
  })
})
