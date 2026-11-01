import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabaseClient: {} }))

import { tituloComprobante } from './ventas'

describe('tituloComprobante (MSF-628)', () => {
  it('rotula factura, presupuesto y nota de crédito, sin «undefined»', () => {
    expect(tituloComprobante('factura', '00000012')).toBe('Factura 00000012')
    expect(tituloComprobante('presupuesto', '00000003')).toBe('Presupuesto 00000003')
    expect(tituloComprobante('nota_credito', '00000001')).toBe('Nota de crédito 00000001')
  })

  it('un tipo desconocido cae en «Comprobante»', () => {
    expect(tituloComprobante('otro', '00000001')).toBe('Comprobante 00000001')
  })
})
