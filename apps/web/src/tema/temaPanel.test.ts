import { describe, expect, it } from 'vitest'
import { temaPanel } from './temaPanel'
import { tokens } from './tokens'

describe('temaPanel', () => {
  it('usa Sora en títulos e Instrument Sans en texto', () => {
    expect(temaPanel.typography.h1.fontFamily).toContain('Sora')
    expect(temaPanel.typography.fontFamily).toContain('Instrument Sans')
  })

  it('aplica el azul de acción, su hover y el peligro', () => {
    expect(temaPanel.palette.primary.main).toBe('#2B55E6')
    expect(temaPanel.palette.primary.dark).toBe('#1E3FB8')
    expect(temaPanel.palette.error.main).toBe('#C62828')
  })

  it('aplica texto, bordes y fondos de los tokens', () => {
    expect(temaPanel.palette.text.primary).toBe(tokens.color.texto)
    expect(temaPanel.palette.text.secondary).toBe('#5F6670')
    expect(temaPanel.palette.divider).toBe('#D9D8D2')
    expect(temaPanel.palette.background.default).toBe('#F5F5F2')
  })

  it('define botones de 38 px con esquinas de 9 px', () => {
    const raiz = temaPanel.components?.MuiButton?.styleOverrides?.root as Record<string, unknown>
    expect(raiz.minHeight).toBe(38)
    expect(raiz.borderRadius).toBe(9)
  })
})
