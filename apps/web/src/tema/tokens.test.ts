import { describe, expect, it } from 'vitest'
import { temaPanel } from './temaPanel'
import { tokens } from './tokens'

// Los valores esperados se toman del CSS del prototipo (design/pantallas/), no de los tokens,
// para que el test falle si un token se aparta del prototipo (SC-001).
describe('tokens: colores del prototipo', () => {
  it('define los 7 tonos de etiqueta (.chip.n/.p/.ok/.w/.e/.i/.o)', () => {
    expect(tokens.color.etiqueta.neutral).toEqual({ fondo: '#EEEDE8', texto: '#3B4048' })
    expect(tokens.color.etiqueta.primario).toEqual({ fondo: '#E4EAFD', texto: '#1E3FB8' })
    expect(tokens.color.etiqueta.exito).toEqual({ fondo: '#E1F3E7', texto: '#146B35' })
    expect(tokens.color.etiqueta.aviso).toEqual({ fondo: '#FCECD0', texto: '#7A4B00' })
    expect(tokens.color.etiqueta.error).toEqual({ fondo: '#FBE2E2', texto: '#9B1C1C' })
    expect(tokens.color.etiqueta.info).toEqual({ fondo: '#E2EFFA', texto: '#0B4F82' })
    expect(tokens.color.etiqueta.contorno).toEqual({ fondo: '#FFFFFF', texto: '#5F6670', borde: '#D9D8D2' })
  })

  it('define los 4 tonos de alerta (.al.i/.w/.e/.ok)', () => {
    expect(tokens.color.alerta.info).toEqual({ fondo: '#E9F2FC', texto: '#0B4F82', icono: '#0B4F82' })
    expect(tokens.color.alerta.aviso).toEqual({ fondo: '#FCF1DC', texto: '#6E4300', icono: '#B36B00' })
    expect(tokens.color.alerta.error).toEqual({ fondo: '#FBE7E7', texto: '#8A1A1A', icono: '#C62828' })
    expect(tokens.color.alerta.exito).toEqual({ fondo: '#E3F3E8', texto: '#155E36', icono: '#1E7A45' })
  })

  it('define los colores del sider, filas, placeholder y avatar', () => {
    expect(tokens.color.sider).toEqual({
      fondo: '#15181D',
      itemTexto: '#C9CCD2',
      itemTextoActivo: '#FFFFFF',
      itemFondoActivo: '#2B55E6',
      label: '#7C838D',
      rol: '#9AA0A9',
      pieBorde: '#2A2E36',
    })
    expect(tokens.color.fila).toEqual({ negativa: '#FFF6F6', destacada: '#F3F6FE' })
    expect(tokens.color.placeholder).toBe('#8A9099')
    expect(tokens.color.avatar).toEqual({ fondo: '#DCE4FB', texto: '#1E3FB8' })
  })
})

describe('tokens: escala tipográfica del prototipo', () => {
  it('define la escala .t1/.t2/.t3/.b/.bl/.s/.xs/.kpi', () => {
    const { escala } = tokens.tipografia
    expect(escala.t1).toEqual({ tamano: 26, peso: 600, interlineado: 1.2, espaciado: '-0.01em' })
    expect(escala.t2).toEqual({ tamano: 18, peso: 600, interlineado: 1.3, espaciado: '-0.005em' })
    expect(escala.t3).toEqual({ tamano: 15, peso: 600, interlineado: 1.4, espaciado: '0' })
    expect(escala.b).toEqual({ tamano: 14, peso: 400, interlineado: 1.5, espaciado: '0' })
    expect(escala.bl).toEqual({ tamano: 15, peso: 400, interlineado: 1.5, espaciado: '0' })
    expect(escala.s).toEqual({ tamano: 13, peso: 400, interlineado: 1.45, espaciado: '0' })
    expect(escala.xs).toEqual({ tamano: 12, peso: 400, interlineado: 1.4, espaciado: '0' })
    expect(escala.kpi).toEqual({ tamano: 30, peso: 600, interlineado: 1.1, espaciado: '-0.02em' })
  })

  it('sirve la escala como variantes del tema', () => {
    expect(temaPanel.typography.t1.fontSize).toBe('26px')
    expect(temaPanel.typography.t2.fontSize).toBe('18px')
    expect(temaPanel.typography.kpi.fontWeight).toBe(600)
    expect(temaPanel.typography.b.fontFamily).toContain('Instrument Sans')
    expect(temaPanel.typography.t1.fontFamily).toContain('Sora')
  })

  it('el tabular-nums de .num vive en los tokens', () => {
    expect(tokens.tipografia.numeros.tabular).toBe('tabular-nums')
  })
})

describe('tokens: formas y dimensiones del prototipo', () => {
  it('define botón 38/9, botón chico 32/8 y etiqueta 24/999', () => {
    expect(tokens.forma.altoBoton).toBe(38)
    expect(tokens.forma.radioBoton).toBe(9)
    expect(tokens.forma.altoBotonChico).toBe(32)
    expect(tokens.forma.radioBotonChico).toBe(8)
    expect(tokens.forma.altoEtiqueta).toBe(24)
    expect(tokens.forma.radioEtiqueta).toBe(999)
  })

  it('define campo 40/9, ícono 34/8, casilla 18/5, switch 40×22 y segmentado 34/9', () => {
    expect(tokens.forma.altoCampo).toBe(40)
    expect(tokens.forma.radioCampo).toBe(9)
    expect(tokens.forma.altoIconButton).toBe(34)
    expect(tokens.forma.radioIconButton).toBe(8)
    expect(tokens.forma.ladoCheckbox).toBe(18)
    expect(tokens.forma.radioCheckbox).toBe(5)
    expect(tokens.forma.anchoSwitch).toBe(40)
    expect(tokens.forma.altoSwitch).toBe(22)
    expect(tokens.forma.altoSegmentado).toBe(34)
    expect(tokens.forma.radioSegmentado).toBe(9)
  })

  it('define menú, snackbar, alerta y barra', () => {
    expect(tokens.forma.radioMenu).toBe(10)
    expect(tokens.forma.radioSnackbar).toBe(10)
    expect(tokens.forma.radioAlerta).toBe(10)
    expect(tokens.forma.altoBarra).toBe(6)
    expect(tokens.forma.radioBarra).toBe(3)
  })
})
