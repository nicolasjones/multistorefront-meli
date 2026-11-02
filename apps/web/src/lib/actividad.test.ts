import { describe, expect, it } from 'vitest'
import { diaEnBuenosAires, etiquetaTipoActividad, formatearCuando, formatearDetalleActividad, rangoDelPeriodo } from './actividad'

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
    expect(etiquetaTipoActividad('tema_nuevo.accion_rara')).toBe('Tema_nuevo accion rara')
  })
})

describe('etiquetas y detalle legibles (MSF-618)', () => {
  it('los tipos con formato interno salen con tildes', () => {
    expect(etiquetaTipoActividad('categoria.creada')).toBe('Categoría creada')
    expect(etiquetaTipoActividad('cuenta_cobro.creada')).toBe('Cuenta de cobro creada')
    expect(etiquetaTipoActividad('comprobante.nota_credito_emitida')).toBe('Nota de crédito emitida')
    expect(etiquetaTipoActividad('rma.stock_reingresado')).toBe('Stock reingresado')
    expect(etiquetaTipoActividad('stock.salida')).toBe('Salida de stock')
  })

  it('los importes del detalle llevan formato de moneda', () => {
    expect(formatearDetalleActividad('Cobro de 859100 por Tarjeta de débito en la factura A-1')).toBe(
      'Cobro de $ 859.100,00 por Tarjeta de débito en la factura A-1',
    )
    expect(formatearDetalleActividad('Cambió el precio de lista de X: ARS 90919.40 → USD 12,5')).toBe(
      'Cambió el precio de lista de X: ARS 90.919,40 → USD 12,50',
    )
    expect(formatearDetalleActividad('Confirmó la cotización del dólar: $ 1250.5')).toBe('Confirmó la cotización del dólar: $ 1.250,50')
    expect(formatearDetalleActividad('Descontó una reserva de 3 unidades')).toBe('Descontó una reserva de 3 unidades')
  })
})
