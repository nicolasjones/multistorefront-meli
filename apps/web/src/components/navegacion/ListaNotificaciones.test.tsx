import { describe, expect, it } from 'vitest'
import { detalleLegible, horaRelativa } from './notificaciones'

describe('formato de notificaciones (FR-007)', () => {
  it('detalle: texto plano «Clave: valor», sin objetos ni vacíos', () => {
    expect(detalleLegible({ Nombre: 'Ana', Producto: ' ', Anidado: { a: 1 }, Cantidad: 2 })).toBe('Nombre: Ana · Cantidad: 2')
    expect(detalleLegible(null)).toBe('')
  })
  it('detalle largo se recorta', () => {
    expect(detalleLegible({ Mensaje: 'x'.repeat(500) }).length).toBeLessThanOrEqual(140)
  })
  it('hora relativa en castellano', () => {
    const ahora = Date.parse('2027-01-01T12:00:00Z')
    expect(horaRelativa('2027-01-01T11:59:40Z', ahora)).toBe('ahora')
    expect(horaRelativa('2027-01-01T10:00:00Z', ahora)).toBe('hace 2 horas')
    expect(horaRelativa('2026-12-30T12:00:00Z', ahora)).toBe('anteayer')
  })
})
