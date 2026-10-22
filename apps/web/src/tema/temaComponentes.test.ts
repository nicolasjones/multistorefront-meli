import { describe, expect, it } from 'vitest'
import { temaPanel } from './temaPanel'
import { tokens } from './tokens'

// Verifica que los componentes de paridad toman sus valores de los tokens y
// no de literales (FR-005, SC-002).
const overrides = (nombre: string) =>
  ((temaPanel.components as unknown as Record<string, { styleOverrides?: Record<string, Record<string, unknown>> }>)[nombre]
    ?.styleOverrides ?? {})

describe('tema: componentes de paridad', () => {
  it('casilla (.cb) y switch (.sw) del prototipo', () => {
    expect(overrides('MuiCheckbox').root.color).toBe(tokens.color.control.checkBorde)
    expect((overrides('MuiCheckbox').root['&.Mui-checked'] as Record<string, unknown>).color).toBe(tokens.color.control.checkActivo)
    expect(overrides('MuiSwitch').track.width).toBe(tokens.forma.anchoSwitch)
    expect(overrides('MuiSwitch').track.height).toBe(tokens.forma.altoSwitch)
    expect(overrides('MuiSwitch').track.backgroundColor).toBe(tokens.color.control.switchApagado)
  })

  it('alertas (.al) con los cuatro tonos del prototipo', () => {
    expect(overrides('MuiAlert').standardInfo.backgroundColor).toBe(tokens.color.alerta.info.fondo)
    expect(overrides('MuiAlert').standardWarning.backgroundColor).toBe(tokens.color.alerta.aviso.fondo)
    expect(overrides('MuiAlert').standardError.backgroundColor).toBe(tokens.color.alerta.error.fondo)
    expect(overrides('MuiAlert').standardSuccess.backgroundColor).toBe(tokens.color.alerta.exito.fondo)
  })

  it('menú (.menu), snack (.snack), tabs, barra (.bar) y avatar (.avatar)', () => {
    expect(overrides('MuiMenu').paper.borderRadius).toBe(tokens.forma.radioMenu)
    expect((overrides('MuiMenuItem').root['&.Mui-selected'] as Record<string, unknown>).backgroundColor).toBe(tokens.color.fila.destacada)
    expect(overrides('MuiSnackbarContent').root.borderRadius).toBe(tokens.forma.radioSnackbar)
    expect(overrides('MuiTabs').root.borderBottom).toBe(`1px solid ${tokens.color.bordeSuave}`)
    expect(overrides('MuiLinearProgress').root.height).toBe(tokens.forma.altoBarra)
    expect(overrides('MuiAvatar').root.backgroundColor).toBe(tokens.color.avatar.fondo)
  })

  it('el sider oscuro se limita a los drawers anclados a la izquierda', () => {
    const drawer = overrides('MuiDrawer')
    expect(drawer.paperAnchorDockedLeft.backgroundColor).toBe(tokens.color.sider.fondo)
    expect(drawer.paperAnchorLeft.backgroundColor).toBe(tokens.color.sider.fondo)
    expect(drawer.paperAnchorRight).toBeUndefined()
  })
})
