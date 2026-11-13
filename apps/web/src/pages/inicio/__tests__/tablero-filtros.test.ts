import { describe, expect, it } from 'vitest'
import { enlaceVentas, errorDeRango, leerFiltros, parametrosConDeposito, parametrosConPeriodo } from '../tablero/filtros'

const AHORA = new Date('2026-10-15T15:00:00Z')
const DEPOSITO = 'd1000000-0000-4000-8000-000000000001'

describe('Filtros del tablero de Inicio (FR-001)', () => {
  it('por defecto: el mes en curso y todos los depósitos', () => {
    const filtros = leerFiltros(new URLSearchParams(), AHORA)
    expect(filtros).toMatchObject({ periodo: 'este-mes', rango: { desde: '2026-10-01', hasta: '2026-10-15' }, errorRango: null, depositoId: null })
  })

  it.each([
    ['hoy', { desde: '2026-10-15', hasta: '2026-10-15' }],
    ['siete-dias', { desde: '2026-10-09', hasta: '2026-10-15' }],
  ])('atajo %s', (periodo, rango) => {
    expect(leerFiltros(new URLSearchParams({ periodo }), AHORA)).toMatchObject({ periodo, rango })
  })

  it('un período desconocido cae en el mes en curso', () => {
    expect(leerFiltros(new URLSearchParams({ periodo: 'ayer' }), AHORA).periodo).toBe('este-mes')
  })

  it('rango libre válido', () => {
    const filtros = leerFiltros(new URLSearchParams({ periodo: 'rango', desde: '2026-09-01', hasta: '2026-09-30' }), AHORA)
    expect(filtros).toMatchObject({ periodo: 'rango', rango: { desde: '2026-09-01', hasta: '2026-09-30' }, errorRango: null })
  })

  it('rango libre inválido: avisa y consulta el mes en curso (nunca un rango roto)', () => {
    const filtros = leerFiltros(new URLSearchParams({ periodo: 'rango', desde: '2026-09-30', hasta: '2026-09-01' }), AHORA)
    expect(filtros.errorRango).toBe('Hasta no puede ser anterior a Desde.')
    expect(filtros.rango).toEqual({ desde: '2026-10-01', hasta: '2026-10-15' })
  })

  it('rechaza fechas inexistentes, vacías y rangos de más de 366 días', () => {
    expect(errorDeRango({ desde: '2026-02-31', hasta: '2026-03-01' })).not.toBeNull()
    expect(errorDeRango({ desde: '', hasta: '2026-03-01' })).toBe('Indicá las dos fechas.')
    expect(errorDeRango({ desde: '2025-01-01', hasta: '2026-03-01' })).toBe('El período no puede superar 366 días.')
    expect(errorDeRango({ desde: '2026-01-01', hasta: '2026-12-31' })).toBeNull()
  })

  it('el depósito solo se acepta si es un UUID', () => {
    expect(leerFiltros(new URLSearchParams({ deposito: DEPOSITO }), AHORA).depositoId).toBe(DEPOSITO)
    expect(leerFiltros(new URLSearchParams({ deposito: "1'; drop table" }), AHORA).depositoId).toBeNull()
  })

  it('se reflejan en la URL conservando lo demás', () => {
    const base = new URLSearchParams({ deposito: DEPOSITO })
    expect(parametrosConPeriodo(base, 'hoy').toString()).toBe(`deposito=${DEPOSITO}&periodo=hoy`)
    expect(parametrosConPeriodo(new URLSearchParams({ periodo: 'hoy' }), 'este-mes').toString()).toBe('')
    expect(parametrosConPeriodo(base, 'rango', { desde: '2026-09-01', hasta: '2026-09-30' }).toString()).toContain('periodo=rango&desde=2026-09-01&hasta=2026-09-30')
    expect(parametrosConDeposito(new URLSearchParams({ periodo: 'hoy' }), DEPOSITO).toString()).toBe(`periodo=hoy&deposito=${DEPOSITO}`)
    expect(parametrosConDeposito(base, null).toString()).toBe('')
  })

  it('el enlace de ventas lleva el período', () => {
    expect(enlaceVentas({ desde: '2026-10-01', hasta: '2026-10-15' })).toBe('/ventas/reportes?desde=2026-10-01&hasta=2026-10-15')
  })
})
