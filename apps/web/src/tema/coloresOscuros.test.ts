import { describe, expect, it } from 'vitest'
import { coloresOscuros } from './coloresOscuros'
import { temaPanel, temaPanelOscuro } from './temaPanel'

// Luminancia y contraste de WCAG 2.1 (https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio).
function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export function contraste(a: string, b: string): number {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x)
  return (claro + 0.05) / (oscuro + 0.05)
}

const c = coloresOscuros
const FONDOS = { fondo: c.fondo, superficie: c.superficie, fondoAlterno: c.fondoAlterno }

describe('contraste de la paleta oscura (WCAG 2.1 AA)', () => {
  it('el verificador es correcto: negro sobre blanco = 21 y igual sobre igual = 1', () => {
    expect(contraste('#000000', '#FFFFFF')).toBeCloseTo(21, 5)
    expect(contraste('#777777', '#777777')).toBeCloseTo(1, 5)
  })

  // Texto: 4.5:1 (frontera: se afirma el mínimo y se prueba que el verificador rechaza un par apenas por debajo).
  it.each(Object.entries(FONDOS))('el texto legible sobre %s tiene al menos 4.5:1', (_nombre, fondo) => {
    for (const texto of [c.texto, c.textoSecundario, c.textoTerciario, c.placeholder, c.accion, c.peligro, c.exito, c.aviso, c.info]) {
      expect(contraste(texto, fondo), `${texto} sobre ${fondo}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('el verificador rechaza un par por debajo de 4.5 (gris medio sobre el fondo)', () => {
    expect(contraste('#5A6170', c.superficie)).toBeLessThan(4.5)
  })

  it('las etiquetas y alertas tienen al menos 4.5:1 entre su texto y su fondo', () => {
    for (const tono of [...Object.values(c.etiqueta), ...Object.values(c.alerta)]) {
      expect(contraste(tono.texto, tono.fondo), `${tono.texto} sobre ${tono.fondo}`).toBeGreaterThanOrEqual(4.5)
    }
    for (const tono of Object.values(c.alerta)) expect(contraste(tono.icono, tono.fondo)).toBeGreaterThanOrEqual(3)
  })

  // Gráfico del tablero de Inicio: las barras (primary.main) y la línea de stock (warning.main) son elementos gráficos: 3:1.
  it('las barras y la línea de stock del gráfico tienen al menos 3:1 sobre el papel del tablero', () => {
    const papel = temaPanelOscuro.palette.background.paper
    expect(contraste(temaPanelOscuro.palette.primary.main, papel)).toBeGreaterThanOrEqual(3)
    expect(contraste(temaPanelOscuro.palette.warning.main, papel)).toBeGreaterThanOrEqual(3)
    // Las dos series se distinguen por el tipo de marca (barras / línea con marcas) y por la leyenda, no solo por el color.
  })

  it('los bordes de los controles (casilla, interruptor) tienen al menos 3:1', () => {
    for (const borde of [c.control.checkBorde, c.control.switchEncendido, c.borde]) {
      expect(contraste(borde, c.superficie), borde).toBeGreaterThanOrEqual(3)
    }
  })

  it('el tema oscuro usa la paleta oscura y el claro no cambió', () => {
    expect(temaPanelOscuro.palette.mode).toBe('dark')
    expect(temaPanelOscuro.palette.background.paper).toBe(c.superficie)
    expect(temaPanelOscuro.palette.text.primary).toBe(c.texto)
    expect(temaPanel.palette.mode).toBe('light')
    expect(temaPanel.palette.primary.main).toBe('#2B55E6')
  })
})
