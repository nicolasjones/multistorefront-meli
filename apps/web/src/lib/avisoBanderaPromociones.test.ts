import { describe, expect, it } from 'vitest'
import { MENSAJE_PROMOCIONES_ACTIVADAS, MENSAJE_PROMOCIONES_DESACTIVADAS, avisoCambioBandera } from './avisoBanderaPromociones'

describe('avisoCambioBandera', () => {
  it('sin cambio no avisa', () => {
    expect(avisoCambioBandera(true, true)).toBeNull()
    expect(avisoCambioBandera(false, false)).toBeNull()
  })

  it('avisa cuando se activaron y cuando se desactivaron', () => {
    expect(avisoCambioBandera(false, true)).toBe(MENSAJE_PROMOCIONES_ACTIVADAS)
    expect(avisoCambioBandera(true, false)).toBe(MENSAJE_PROMOCIONES_DESACTIVADAS)
  })

  it('sin lectura no inventa un cambio', () => {
    expect(avisoCambioBandera(null, true)).toBeNull()
    expect(avisoCambioBandera(true, null)).toBeNull()
  })
})
