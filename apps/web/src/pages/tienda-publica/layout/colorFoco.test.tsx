import { render } from '@testing-library/react'
import { ThemeProvider } from '@mui/material'
import { describe, expect, it } from 'vitest'
import { contraste, crearTemaTienda } from '../../../tema/temaTienda'
import { colorFoco } from './colorFoco'
import { FocoVisible } from './FocoVisible'

// MSF-849 (revisión): el contorno de foco del primario no podía bajar de 3:1 (WCAG 1.4.11) con identidades extremas.
const peor = (c: string, fondo: string) => Math.min(contraste(c, fondo), contraste(c, '#FFFFFF'))

describe('colorFoco', () => {
  it('conserva el primario cuando llega a 3:1 contra el fondo y contra el blanco', () => {
    expect(colorFoco('#A3111D', '#1A1A1A', '#FFFFFF')).toBe('#A3111D')
    expect(colorFoco('#C8102E', '#1A1A1A', '#FAF7F0')).toBe('#C8102E')
  })

  it.each([
    ['amarillo #FFD400 sobre blanco', '#FFD400', '#1A1A1A', '#FFFFFF'],
    ['celeste #5BC0EB sobre blanco', '#5BC0EB', '#1A1A1A', '#FFFFFF'],
  ])('%s: pasa al color del texto o al negro y llega a 3:1', (_n, primario, texto, fondo) => {
    const c = colorFoco(primario, texto, fondo)
    expect(c).not.toBe(primario)
    expect(peor(c, fondo)).toBeGreaterThanOrEqual(3)
  })

  it.each([
    ['fondo #1A1A1A con primario #A3111D', '#A3111D', '#F5F5F5', '#1A1A1A'],
    ['primario #222222 sobre #111111', '#222222', '#EEEEEE', '#111111'],
  ])('%s: con la página oscura y el encabezado blanco cae al gris medio y llega a 3:1 contra los dos', (_n, primario, texto, fondo) => {
    const c = colorFoco(primario, texto, fondo)
    expect(c.toLowerCase()).toBe('#767676')
    expect(peor(c, fondo)).toBeGreaterThanOrEqual(3)
  })

  it('con un color inválido devuelve el primario sin romper', () => {
    expect(colorFoco('#A3111D', 'rojo', 'blanco')).toBe('#A3111D')
  })
})

describe('FocoVisible', () => {
  it('publica el color calculado en --tienda-color-foco y excluye el campo de texto del buscador (sin doble anillo)', () => {
    const tema = crearTemaTienda({ colorPrimario: '#FFD400', colorTexto: '#1A1A1A', colorFondo: '#FFFFFF' })
    render(<ThemeProvider theme={tema}><FocoVisible /></ThemeProvider>)
    const css = Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('')
    const m = css.match(/--tienda-color-foco:(#[0-9a-f]{6})/i)
    expect(m).not.toBeNull()
    expect(m![1].toLowerCase()).not.toBe('#ffd400')
    expect(css).toMatch(/\[role="combobox"\]:not\(input\):focus-visible/)
    expect(css).toContain('data-foco="oscuro"')
  })
})
