import { describe, expect, it } from 'vitest'
import { diaEnBuenosAires, etiquetaTipoActividad, formatearCuando, rangoDelPeriodo } from './actividad'

describe('hora de Buenos Aires (F-AUD-01, FR-004)', () => {
  it('el día se calcula en Buenos Aires, no en UTC', () => {
    // 02:30 UTC del 1/10 todavía es 23:30 del 30/09 en Buenos Aires (UTC-3).
    expect(diaEnBuenosAires(new Date('2026-10-01T02:30:00Z'))).toBe('2026-09-30')
    expect(diaEnBuenosAires(new Date('2026-10-01T03:30:00Z'))).toBe('2026-10-01')
  })

  it('«Hoy» respeta el cambio de día de Buenos Aires', () => {
    const ahora = new Date('2026-10-01T02:30:00Z')
    expect(rangoDelPeriodo('hoy', ahora)).toEqual({ desde: '2026-09-30', hasta: '2026-09-30' })
  })

  it('los últimos 7 y 30 días incluyen hoy', () => {
    const ahora = new Date('2026-10-10T15:00:00Z')
    expect(rangoDelPeriodo('7dias', ahora)).toEqual({ desde: '2026-10-04', hasta: '2026-10-10' })
    expect(rangoDelPeriodo('30dias', ahora)).toEqual({ desde: '2026-09-11', hasta: '2026-10-10' })
  })

  it('«todo el historial» no acota fechas', () => {
    expect(rangoDelPeriodo('todo')).toEqual({ desde: null, hasta: null })
  })

  it('muestra «Cuándo» como dd/mm/aaaa hh:mm en hora de Buenos Aires', () => {
    expect(formatearCuando('2026-10-01T03:30:00Z')).toBe('01/10/2026 00:30')
    expect(formatearCuando('2026-10-01T02:30:00Z')).toBe('30/09/2026 23:30')
  })
})

describe('etiqueta del tipo', () => {
  it('traduce los tipos conocidos', () => {
    expect(etiquetaTipoActividad('usuario.rol_cambiado')).toBe('Cambio de rol')
  })

  it('un tipo nuevo de otro componente se muestra legible', () => {
    expect(etiquetaTipoActividad('producto.creado')).toBe('Producto creado')
    expect(etiquetaTipoActividad('stock.ajuste_manual')).toBe('Stock ajuste manual')
    expect(etiquetaTipoActividad('reparacion.creada')).toBe('Reparación creada')
    expect(etiquetaTipoActividad('rma.estado_cambiado')).toBe('RMA estado cambiado')
  })

  it('lleva tildes en los tipos de comprobante, RMA y reparación', () => {
    expect(etiquetaTipoActividad('comprobante.nota_credito_emitida')).toBe('Comprobante nota crédito emitida')
    expect(etiquetaTipoActividad('rma.nota_credito_vinculada')).toBe('RMA nota crédito vinculada')
    expect(etiquetaTipoActividad('reparacion.editada')).toBe('Reparación editada')
  })
})
