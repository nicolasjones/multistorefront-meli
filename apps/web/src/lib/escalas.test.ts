import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import {
  PRECIOS_ESCALA_VACIOS,
  escalaDeTipoCliente,
  guardarPreciosEscala,
  hayCambiosEscalas,
  hayPreciosEscala,
  leerPreciosEscala,
  margenDeEscala,
  mensajeErrorEscalas,
  rotuloEscala,
  validarPreciosEscala,
} from './escalas'

describe('rotuloEscala (F-PRE-15, FR-026)', () => {
  it('rotula las cuatro escalas con su rango de unidades', () => {
    expect(rotuloEscala('x1')).toBe('x1 · 1 a 4 u.')
    expect(rotuloEscala('x5')).toBe('x5 · 5 a 9 u.')
    expect(rotuloEscala('x10')).toBe('x10 · 10 a 49 u.')
    expect(rotuloEscala('x50')).toBe('x50 · 50 u. o más')
  })
})

describe('validarPreciosEscala', () => {
  it('vacío es válido (escala sin precio) y cero o más también', () => {
    expect(validarPreciosEscala(PRECIOS_ESCALA_VACIOS)).toEqual({})
    expect(validarPreciosEscala({ x5: '0', x10: '799,50', x50: '600.5' })).toEqual({})
  })

  it('rechaza negativos, letras y más de 2 decimales, escala por escala', () => {
    const errores = validarPreciosEscala({ x5: '-1', x10: 'abc', x50: '10,123' })
    expect(Object.keys(errores).sort()).toEqual(['x10', 'x5', 'x50'])
    expect(errores.x5).toMatch(/cero o más/)
  })
})

describe('cambios de escalas', () => {
  it('detecta un cambio real e ignora los espacios', () => {
    expect(hayCambiosEscalas({ x5: '800', x10: '', x50: '' }, { x5: ' 800 ', x10: '', x50: '' })).toBe(false)
    expect(hayCambiosEscalas({ x5: '800', x10: '', x50: '' }, { x5: '700', x10: '', x50: '' })).toBe(true)
  })

  it('hayPreciosEscala distingue el formulario vacío', () => {
    expect(hayPreciosEscala(PRECIOS_ESCALA_VACIOS)).toBe(false)
    expect(hayPreciosEscala({ x5: '', x10: '1', x50: '' })).toBe(true)
  })
})

describe('margenDeEscala', () => {
  const ars = { moneda: 'ARS' as const, precioLista: '1000', costo: '600' }

  it('x1 usa el precio de lista: (1.000 − 600) / 1.000 = 40 %', () => {
    expect(margenDeEscala(ars, 'x1', PRECIOS_ESCALA_VACIOS, null)).toBe(0.4)
  })

  it('una escala con precio usa el suyo: (800 − 600) / 800 = 25 %', () => {
    expect(margenDeEscala(ars, 'x5', { x5: '800', x10: '', x50: '' }, null)).toBe(0.25)
  })

  it('una escala sin precio cae en el de lista', () => {
    expect(margenDeEscala(ars, 'x10', { x5: '800', x10: '', x50: '' }, null)).toBe(0.4)
  })

  it('USD se convierte con el dólar y sin cotización no inventa margen', () => {
    const usd = { moneda: 'USD' as const, precioLista: '20', costo: '12' }
    expect(margenDeEscala(usd, 'x5', { x5: '16', x10: '', x50: '' }, 1465)).toBe(0.25)
    expect(margenDeEscala(usd, 'x5', { x5: '16', x10: '', x50: '' }, null)).toBeNull()
  })

  it('sin costo no hay margen', () => {
    expect(margenDeEscala({ ...ars, costo: '' }, 'x1', PRECIOS_ESCALA_VACIOS, null)).toBeNull()
  })
})

describe('escalaDeTipoCliente (contrato tipos_cliente.escala_precio, FR-027)', () => {
  it('«Mayorista» = x5 pasa a precio_para como x5', () => {
    expect(escalaDeTipoCliente('x5')).toBe('x5')
  })

  it('sin escala definida usa x1 (Minorista)', () => {
    expect(escalaDeTipoCliente(null)).toBe('x1')
    expect(escalaDeTipoCliente(undefined)).toBe('x1')
    expect(escalaDeTipoCliente('  ')).toBe('x1')
    expect(escalaDeTipoCliente('x1')).toBe('x1')
  })

  it('acepta mayúsculas y espacios', () => {
    expect(escalaDeTipoCliente(' X10 ')).toBe('x10')
  })

  it('una escala inexistente es un error de datos, no un precio', () => {
    expect(() => escalaDeTipoCliente('x7')).toThrow(/x7/)
  })
})

describe('guardarPreciosEscala', () => {
  it('manda las tres escalas a la RPC: vacío = null y la coma decimal se normaliza', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null })
    await guardarPreciosEscala({ rpc } as unknown as Pick<SupabaseClient, 'rpc'>, 'p1', { x5: '800,50', x10: '', x50: '600' })
    expect(rpc).toHaveBeenCalledWith('guardar_precios_escala', { p_producto: 'p1', p_x5: 800.5, p_x10: null, p_x50: 600 })
  })

  it('propaga el error de la base', async () => {
    const error = { code: '42501' }
    const rpc = vi.fn().mockResolvedValue({ error })
    await expect(
      guardarPreciosEscala({ rpc } as unknown as Pick<SupabaseClient, 'rpc'>, 'p1', PRECIOS_ESCALA_VACIOS),
    ).rejects.toBe(error)
  })
})

describe('leerPreciosEscala', () => {
  const clienteCon = (resultado: { data: unknown; error: unknown }) =>
    ({
      schema: () => ({ from: () => ({ select: () => ({ eq: () => ({ returns: async () => resultado }) }) }) }),
    }) as unknown as Pick<SupabaseClient, 'schema'>

  it('arma el formulario con las escalas cargadas y deja vacías las demás', async () => {
    const valores = await leerPreciosEscala(
      clienteCon({ data: [{ escala: 'x5', precio: '800.50' }, { escala: 'x10', precio: null }], error: null }),
      'p1',
    )
    expect(valores).toEqual({ x5: '800,50', x10: '', x50: '' })
  })

  it('no comparte el objeto vacío entre lecturas', async () => {
    const valores = await leerPreciosEscala(clienteCon({ data: [], error: null }), 'p1')
    valores.x5 = '1'
    expect(PRECIOS_ESCALA_VACIOS.x5).toBe('')
  })

  it('propaga el error de la base', async () => {
    const error = { code: 'XX000' }
    await expect(leerPreciosEscala(clienteCon({ data: null, error }), 'p1')).rejects.toBe(error)
  })
})

describe('mensajeErrorEscalas', () => {
  it('traduce los códigos de la base sin filtrar el mensaje crudo', () => {
    expect(mensajeErrorEscalas({ code: '42501', message: 'policy xyz' })).toMatch(/Tu rol no puede/)
    expect(mensajeErrorEscalas({ code: '23514' })).toMatch(/cero o más/)
    expect(mensajeErrorEscalas({ code: '22003' })).toMatch(/demasiado grande/)
    expect(mensajeErrorEscalas({ code: 'P0002' })).toMatch(/ya no existe/)
    expect(mensajeErrorEscalas(new Error('boom'))).toMatch(/No pudimos guardar/)
  })
})
