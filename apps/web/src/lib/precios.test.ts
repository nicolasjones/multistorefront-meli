import { describe, expect, it, vi } from 'vitest'
import {
  REGLA_SIN_GUARDAR,
  aPesos,
  ajusteATexto,
  fijarCotizacionInicial,
  formatearFechaCotizacion,
  formatearMargen,
  formatearPesosPrecio,
  leerCotizacionInicial,
  leerReglaPrecioEmpresa,
  mensajeErrorCotizacion,
  mensajeErrorRegla,
  parsearAjuste,
  resumirPrecios,
  validarAjuste,
} from './precios'

describe('aPesos', () => {
  it('ARS queda igual y no necesita cotización', () => {
    expect(aPesos(1000, 'ARS', null)).toBe(1000)
  })

  it('USD sin cotización no inventa un valor', () => {
    expect(aPesos(20, 'USD', null)).toBeNull()
  })

  it('USD × cotización: 20 × 1.465 = 29.300 y costo 12 × 1.465 = 17.580', () => {
    expect(aPesos(20, 'USD', 1465)).toBe(29300)
    expect(aPesos(12, 'USD', 1465)).toBe(17580)
  })

  it('redondea a 2 decimales como round(x, 2) de la base (mitad hacia arriba, sin error de coma flotante)', () => {
    // 1,005 × 1 = 1,005 → 1,01 en la base; con coma flotante Math.round(1.005 * 100) da 100.
    expect(aPesos(1.01, 'USD', 0.995)).toBe(1) // 1,00495 → 1,00
    expect(aPesos(0.01, 'USD', 0.5)).toBe(0.01) // 0,005 → 0,01
  })
})

describe('resumirPrecios', () => {
  it('calcula precio, costo en pesos y margen sobre el neto (40 %)', () => {
    expect(resumirPrecios({ moneda: 'USD', precioLista: '20', costo: '12' }, 1465)).toEqual({
      precioArs: 29300, costoArs: 17580, margen: 0.4,
    })
  })

  it('acepta coma decimal', () => {
    expect(resumirPrecios({ moneda: 'ARS', precioLista: '1000,50', costo: '' }, null).precioArs).toBe(1000.5)
  })

  it('sin costo no hay margen; lista vacía, cero o inválida no tiene precio', () => {
    expect(resumirPrecios({ moneda: 'ARS', precioLista: '100', costo: '' }, null).margen).toBeNull()
    for (const precioLista of ['', '0', 'abc', '-3']) {
      expect(resumirPrecios({ moneda: 'ARS', precioLista, costo: '5' }, null)).toEqual({ precioArs: null, costoArs: 5, margen: null })
    }
  })

  it('USD sin cotización no tiene precio, costo ni margen en pesos', () => {
    expect(resumirPrecios({ moneda: 'USD', precioLista: '20', costo: '12' }, null)).toEqual({
      precioArs: null, costoArs: null, margen: null,
    })
  })

  it('el margen puede ser negativo cuando el costo supera al precio', () => {
    expect(resumirPrecios({ moneda: 'ARS', precioLista: '100', costo: '150' }, null).margen).toBe(-0.5)
  })
})

describe('formato', () => {
  it('pesos al estilo argentino y margen en porcentaje', () => {
    expect(formatearPesosPrecio(17580)).toBe('$ 17.580')
    expect(formatearMargen(0.4)).toBe('40 %')
    expect(formatearMargen(null)).toBe('—')
  })

  it('fecha corta de la cotización en hora de Buenos Aires', () => {
    // 2026-09-25 01:00 UTC es todavía el 24/09 en Buenos Aires (UTC−3): jueves.
    expect(formatearFechaCotizacion('2026-09-25T01:00:00Z')).toBe('jue 24/09')
    expect(formatearFechaCotizacion('no es una fecha')).toBe('')
  })
})

describe('acceso a la cotización', () => {
  const clienteLectura = (resultado: { data: unknown; error: unknown }) => {
    const maybeSingle = vi.fn().mockResolvedValue(resultado)
    const select = vi.fn(() => ({ maybeSingle }))
    const from = vi.fn(() => ({ select }))
    const schema = vi.fn(() => ({ from }))
    return { cliente: { schema } as never, schema, from, select }
  }

  it('lee la fila de dominio.cotizacion_inicial y la entrega como número', async () => {
    const { cliente, schema, from, select } = clienteLectura({ data: { valor: '1465.0000', updated_at: '2026-09-25T12:00:00Z' }, error: null })
    await expect(leerCotizacionInicial(cliente)).resolves.toEqual({ valor: 1465, fecha: '2026-09-25T12:00:00Z' })
    expect(schema).toHaveBeenCalledWith('dominio')
    expect(from).toHaveBeenCalledWith('cotizacion_inicial')
    expect(select).toHaveBeenCalledWith('valor, updated_at')
  })

  it('sin fila devuelve null y un error de la base se propaga', async () => {
    await expect(leerCotizacionInicial(clienteLectura({ data: null, error: null }).cliente)).resolves.toBeNull()
    const falla = { code: '42501' }
    await expect(leerCotizacionInicial(clienteLectura({ data: null, error: falla }).cliente)).rejects.toBe(falla)
  })

  it('fija la cotización por la RPC y propaga su error', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { code: '23514' } })
    await expect(fijarCotizacionInicial({ rpc } as never, 1465)).resolves.toBeUndefined()
    expect(rpc).toHaveBeenCalledWith('fijar_cotizacion_inicial', { p_valor: 1465 })
    await expect(fijarCotizacionInicial({ rpc } as never, 0)).rejects.toEqual({ code: '23514' })
  })

  it('mapea los errores de la base a mensajes claros sin filtrar el texto crudo', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(mensajeErrorCotizacion({ code: '42501', message: 'new row violates row-level security policy' })).toMatch(/Administrador/)
    expect(mensajeErrorCotizacion({ code: '23514' })).toMatch(/mayor a cero/)
    expect(mensajeErrorCotizacion({ code: '22003' })).toMatch(/demasiado grande/)
    expect(mensajeErrorCotizacion({ code: 'XX000', message: 'detalle interno' })).toBe('No pudimos guardar la cotización. Probá de nuevo.')
  })
})

describe('regla de precio por empresa (F-PRE-07)', () => {
  it('parsearAjuste acepta signos, coma y menos tipográfico, y rechaza lo demás', () => {
    expect(parsearAjuste('8')).toBe(8)
    expect(parsearAjuste('+8')).toBe(8)
    expect(parsearAjuste('-5')).toBe(-5)
    expect(parsearAjuste('−5')).toBe(-5)
    expect(parsearAjuste(' 8,5 ')).toBe(8.5)
    expect(parsearAjuste('1.234')).toBeNull()
    expect(parsearAjuste('1,234')).toBe(1.234)
    expect(parsearAjuste('1.23')).toBe(1.23)
    expect(parsearAjuste('1.2345')).toBeNull()
    expect(parsearAjuste('')).toBeNull()
    expect(parsearAjuste('abc')).toBeNull()
    expect(parsearAjuste('8%')).toBeNull()
  })

  it('validarAjuste exige un número en rango solo con «Central con ajuste»', () => {
    expect(validarAjuste('central', '')).toBeUndefined()
    expect(validarAjuste('central', 'abc')).toBeUndefined()
    expect(validarAjuste('central_ajuste', '')).toMatch(/Ingresá el ajuste/)
    expect(validarAjuste('central_ajuste', 'abc')).toMatch(/número válido/)
    expect(validarAjuste('central_ajuste', '-100')).toBe('El ajuste debe ser mayor a −100 %.')
    expect(validarAjuste('central_ajuste', '-150')).toBe('El ajuste debe ser mayor a −100 %.')
    expect(validarAjuste('central_ajuste', '10000')).toBe('El ajuste es demasiado grande.')
    expect(validarAjuste('central_ajuste', '-99,999')).toBeUndefined()
    expect(validarAjuste('central_ajuste', '8')).toBeUndefined()
  })

  it('ajusteATexto usa coma decimal', () => {
    expect(ajusteATexto(8)).toBe('8')
    expect(ajusteATexto(-2.5)).toBe('-2,5')
  })

  it('mensajeErrorRegla traduce los códigos de la base sin exponer el texto crudo', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(mensajeErrorRegla({ code: '42501', message: 'new row violates row-level security policy' })).toMatch(/Solo el Administrador/)
    expect(mensajeErrorRegla({ code: '40001' })).toMatch(/Otra persona modificó/)
    expect(mensajeErrorRegla({ code: '23514' })).toMatch(/mayor a −100 %/)
    expect(mensajeErrorRegla({ code: '22003' })).toMatch(/demasiado grande/)
    expect(mensajeErrorRegla({ code: 'P0002' })).toMatch(/ya no existe/)
    expect(mensajeErrorRegla(new Error('boom'))).toBe('No pudimos guardar los precios de la empresa. Probá de nuevo.')
  })

  it('leerReglaPrecioEmpresa: sin fila es «Igual al central»; con fila trae base, ajuste y updated_at', async () => {
    const cliente = (data: unknown) =>
      ({ schema: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data, error: null }) }) }) }) }) }) as never
    expect(await leerReglaPrecioEmpresa(cliente(null), 'e-1')).toEqual(REGLA_SIN_GUARDAR)
    expect(await leerReglaPrecioEmpresa(cliente({ base: 'central_ajuste', ajuste_pct: '8.000', updated_at: 'ts' }), 'e-1')).toEqual({
      base: 'central_ajuste',
      ajustePct: 8,
      actualizadoEn: 'ts',
    })
  })
})
