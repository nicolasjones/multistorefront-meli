import { describe, expect, it } from 'vitest'
import { hoyEnOrganizacion, periodoAnteriorIgualDuracion, rangoDeAtajo, rangoEsValido, validarRango, validarRangos } from './periodosRanking'

// 15/10/2026 12:00 en Buenos Aires (UTC-3).
const AHORA = new Date('2026-10-15T15:00:00Z')

describe('periodosRanking', () => {
  it('calcula «hoy» en la zona de la organización, no en UTC', () => {
    // 01:00 UTC del 16 sigue siendo 15 en Buenos Aires.
    expect(hoyEnOrganizacion(new Date('2026-10-16T01:00:00Z'))).toBe('2026-10-15')
  })

  it('resuelve los cuatro atajos', () => {
    expect(rangoDeAtajo('este-mes', AHORA)).toEqual({ desde: '2026-10-01', hasta: '2026-10-15' })
    expect(rangoDeAtajo('mes-anterior', AHORA)).toEqual({ desde: '2026-09-01', hasta: '2026-09-30' })
    expect(rangoDeAtajo('ultimos-90-dias', AHORA)).toEqual({ desde: '2026-07-18', hasta: '2026-10-15' })
    expect(rangoDeAtajo('anio-en-curso', AHORA)).toEqual({ desde: '2026-01-01', hasta: '2026-10-15' })
  })

  it('«Mes anterior» cruza el cambio de año y años bisiestos', () => {
    expect(rangoDeAtajo('mes-anterior', new Date('2027-01-10T15:00:00Z'))).toEqual({ desde: '2026-12-01', hasta: '2026-12-31' })
    expect(rangoDeAtajo('mes-anterior', new Date('2028-03-10T15:00:00Z'))).toEqual({ desde: '2028-02-01', hasta: '2028-02-29' })
  })

  it('acepta un rango válido con extremos iguales', () => {
    expect(validarRango({ desde: '2026-10-01', hasta: '2026-10-01' })).toEqual({})
    expect(rangoEsValido({ desde: '2026-10-01', hasta: '2026-10-31' })).toBe(true)
  })

  it('rechaza fechas vacías o inexistentes con un error por campo', () => {
    expect(validarRango({ desde: '', hasta: '2026-10-01' }).desde).toBe('Indicá la fecha Desde.')
    expect(validarRango({ desde: '2026-10-01', hasta: '' }).hasta).toBe('Indicá la fecha Hasta.')
    expect(validarRango({ desde: '2026-02-31', hasta: '2026-10-01' }).desde).toBe('La fecha Desde no es válida.')
    expect(validarRango({ desde: 'ayer', hasta: '2026-10-01' }).desde).toBe('La fecha Desde no es válida.')
  })

  it('rechaza Hasta anterior a Desde', () => {
    expect(validarRango({ desde: '2026-10-02', hasta: '2026-10-01' }).hasta).toBe('Hasta no puede ser anterior a Desde.')
  })

  it('el rango máximo es de 5 años calendario (inclusive)', () => {
    expect(validarRango({ desde: '2021-10-15', hasta: '2026-10-15' })).toEqual({})
    expect(validarRango({ desde: '2021-10-15', hasta: '2026-10-16' }).hasta).toBe('El rango máximo es de 5 años.')
    // 29/02 + 5 años = 28/02, como en Postgres.
    expect(validarRango({ desde: '2024-02-29', hasta: '2029-02-28' })).toEqual({})
    expect(validarRango({ desde: '2024-02-29', hasta: '2029-03-01' }).hasta).toBe('El rango máximo es de 5 años.')
  })
})

describe('periodoAnteriorIgualDuracion', () => {
  it('un mes calendario completo da los mismos días inmediatamente antes', () => {
    expect(periodoAnteriorIgualDuracion({ desde: '2026-10-01', hasta: '2026-10-31' })).toEqual({ desde: '2026-08-31', hasta: '2026-09-30' })
  })

  it('un solo día da el día anterior', () => {
    expect(periodoAnteriorIgualDuracion({ desde: '2026-10-15', hasta: '2026-10-15' })).toEqual({ desde: '2026-10-14', hasta: '2026-10-14' })
  })

  it('cruza el cambio de año y los años bisiestos', () => {
    expect(periodoAnteriorIgualDuracion({ desde: '2027-01-01', hasta: '2027-01-10' })).toEqual({ desde: '2026-12-22', hasta: '2026-12-31' })
    expect(periodoAnteriorIgualDuracion({ desde: '2028-03-01', hasta: '2028-03-05' })).toEqual({ desde: '2028-02-25', hasta: '2028-02-29' })
  })

  it('con un rango inválido no inventa fechas', () => {
    expect(periodoAnteriorIgualDuracion({ desde: '', hasta: '2026-10-01' })).toBeNull()
    expect(periodoAnteriorIgualDuracion({ desde: '2026-10-02', hasta: '2026-10-01' })).toBeNull()
  })
})

describe('validarRangos', () => {
  it('valida cada período por separado', () => {
    expect(validarRangos({ desde: '2026-10-01', hasta: '2026-10-31' }, { desde: '2026-09-30', hasta: '2026-09-01' })).toEqual({
      aplicado: {}, comparacion: { hasta: 'Hasta no puede ser anterior a Desde.' },
    })
  })

  it('acepta períodos superpuestos o idénticos', () => {
    const rango = { desde: '2026-10-01', hasta: '2026-10-31' }
    expect(validarRangos(rango, rango)).toEqual({ aplicado: {}, comparacion: {} })
  })
})
