import { describe, expect, it } from 'vitest'
import {
  ATAJOS_RANGO,
  rangoEsValido,
  rangoPorAtajo,
  urlParamsReportes,
  valorRangoNativo,
} from './ventas-reportes'

// 8 de octubre de 2026 (mediodía UTC = 9 de la mañana en la zona de la organización).
const AHORA = new Date('2026-10-08T12:00:00Z')

describe('rangos de período de Reportes de ventas (F-VTA-22, FR-005)', () => {
  it('los atajos son los del prototipo', () => {
    expect(ATAJOS_RANGO.map((atajo) => atajo.etiqueta)).toEqual(['Hoy', '7 días', 'Este mes', 'Mes anterior'])
  })

  it('cada atajo arma su rango', () => {
    expect(rangoPorAtajo('hoy', AHORA)).toEqual({ desde: '2026-10-08', hasta: '2026-10-08' })
    expect(rangoPorAtajo('siete-dias', AHORA)).toEqual({ desde: '2026-10-02', hasta: '2026-10-08' })
    expect(rangoPorAtajo('este-mes', AHORA)).toEqual({ desde: '2026-10-01', hasta: '2026-10-08' })
    expect(rangoPorAtajo('mes-anterior', AHORA)).toEqual({ desde: '2026-09-01', hasta: '2026-09-30' })
  })

  it('el mes anterior de un año bisiesto cierra bien', () => {
    expect(rangoPorAtajo('mes-anterior', new Date('2024-03-15T12:00:00Z'))).toEqual({
      desde: '2024-02-01',
      hasta: '2024-02-29',
    })
  })

  it('un rango es válido si las fechas existen y «desde» no es posterior a «hasta»', () => {
    expect(rangoEsValido({ desde: '2026-10-01', hasta: '2026-10-31' })).toBe(true)
    expect(rangoEsValido({ desde: '2026-10-31', hasta: '2026-10-01' })).toBe(false)
    expect(rangoEsValido({ desde: '2026-02-31', hasta: '2026-03-01' })).toBe(false)
    expect(rangoEsValido({ desde: '', hasta: '2026-03-01' })).toBe(false)
  })

  it('el valor del filtro nativo de período es el rango de Superset', () => {
    expect(valorRangoNativo({ desde: '2026-10-01', hasta: '2026-10-08' })).toBe('2026-10-01 : 2026-10-08')
  })
})

describe('parámetros del embebido (native_filters en rison)', () => {
  const rango = { desde: '2026-10-01', hasta: '2026-10-08' }

  it('siempre preselecciona el filtro nativo de período', () => {
    const rison = urlParamsReportes({ rango, empresa: null }).native_filters
    expect(rison).toContain('NATIVE_FILTER-rango')
    expect(rison).toContain("time_range:'2026-10-01 : 2026-10-08'")
    expect(rison).not.toContain('NATIVE_FILTER-empresa')
  })

  it('con empresa elegida preselecciona también el filtro nativo de empresa', () => {
    const rison = urlParamsReportes({ rango, empresa: 'San Javucho' }).native_filters
    expect(rison).toContain('NATIVE_FILTER-empresa')
    expect(rison).toContain('col:empresa_nombre,op:IN,val:!(\'San Javucho\')')
  })

  it('escapa los caracteres que romperían el rison', () => {
    const rison = urlParamsReportes({ rango, empresa: "San ! Javucho's" }).native_filters
    expect(rison).toContain("val:!('San !! Javucho!'s')")
  })
})
