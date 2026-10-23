import { describe, expect, it, vi } from 'vitest'
import {
  MENSAJE_VALOR_INVALIDO,
  cargarCotizacionRpc,
  esVariacionInusual,
  formatearCotizacion,
  formatearVariacion,
  leerEstadoCotizacion,
  mensajeDeErrorCotizacion,
  parsearCotizacion,
  soloCaracteresDeCotizacion,
  subtituloVigente,
  textoAnterior,
  variacionPorcentual,
} from './cotizacion'

const clienteCon = (resultado: { data: unknown; error: unknown }) => {
  const rpc = vi.fn().mockResolvedValue(resultado)
  return { rpc, cliente: { rpc } as never }
}

describe('parsearCotizacion', () => {
  it('acepta 1490 y 1490,50 (y el punto de miles)', () => {
    expect(parsearCotizacion('1490')).toBe(1490)
    expect(parsearCotizacion('1490,50')).toBe(1490.5)
    expect(parsearCotizacion('1.490')).toBe(1490)
    expect(parsearCotizacion('1.490,5')).toBe(1490.5)
  })

  it('rechaza vacío, cero, no numérico y formatos ambiguos', () => {
    for (const texto of ['', '  ', '0', '0,00', 'abc', '1490.50', '1,2,3', ',5', '12345,12345', '-5']) {
      expect(parsearCotizacion(texto), texto).toBeNull()
    }
  })

  it('rechaza lo que la base no soporta (≥ 10.000.000.000)', () => {
    expect(parsearCotizacion('10000000000')).toBeNull()
    expect(parsearCotizacion('9999999999')).toBe(9999999999)
  })
})

describe('soloCaracteresDeCotizacion', () => {
  it('deja dígitos, punto y coma', () => {
    expect(soloCaracteresDeCotizacion('$ 1a490,5-0 USD')).toBe('1490,50')
  })
})

describe('variación', () => {
  it('se calcula contra el anterior y es nula sin anterior', () => {
    expect(variacionPorcentual(1490, 1465)).toBeCloseTo(1.7065, 3)
    expect(variacionPorcentual(1000, null)).toBeNull()
    expect(variacionPorcentual(1000, 0)).toBeNull()
  })

  it('se formatea con signo y coma decimal', () => {
    expect(formatearVariacion(1.7065)).toBe('+1,7 %')
    expect(formatearVariacion(-0.34)).toBe('−0,3 %')
    expect(formatearVariacion(0)).toBe('+0,0 %')
    expect(formatearVariacion(-0.01)).toBe('+0,0 %')
    expect(formatearVariacion(null)).toBe('—')
  })

  it('es inusual solo por encima del 15 % (en cualquier sentido)', () => {
    expect(esVariacionInusual(15)).toBe(false)
    expect(esVariacionInusual(15.1)).toBe(true)
    expect(esVariacionInusual(-20)).toBe(true)
    expect(esVariacionInusual(null)).toBe(false)
  })
})

describe('textos de la tarjeta y el diálogo', () => {
  const vigente = { valor: 1465, cargadaEn: '2026-09-25T12:00:00Z', cargadaPor: 'Javier' }

  it('formatea pesos como en el prototipo', () => {
    expect(formatearCotizacion(1465)).toBe('$ 1.465')
  })

  it('arma «Última carga» con fecha y quién', () => {
    expect(subtituloVigente(vigente)).toBe('Última carga: vie 25/09 por Javier')
    expect(subtituloVigente({ ...vigente, cargadaPor: null })).toBe('Última carga: vie 25/09')
  })

  it('arma «Anterior»', () => {
    expect(textoAnterior(vigente)).toBe('Anterior: $ 1.465 (vie 25/09)')
  })
})

describe('mensajeDeErrorCotizacion', () => {
  it('traduce los códigos de la base a mensajes claros', () => {
    expect(mensajeDeErrorCotizacion({ code: '42501' })).toBe('Tu rol no puede cargar la cotización del dólar.')
    expect(mensajeDeErrorCotizacion({ code: '23514' })).toBe(MENSAJE_VALOR_INVALIDO)
    expect(mensajeDeErrorCotizacion({ code: '22003' })).toBe(MENSAJE_VALOR_INVALIDO)
    expect(mensajeDeErrorCotizacion({ code: 'XX000' })).toBe('No pudimos cargar la cotización. Intentá de nuevo.')
    expect(mensajeDeErrorCotizacion(null)).toBe('No pudimos cargar la cotización. Intentá de nuevo.')
  })
})

describe('llamadas a la base', () => {
  it('estado_cotizacion mapea vigente, productos en USD y pendiente', async () => {
    const { cliente, rpc } = clienteCon({
      data: {
        vigente: { valor: '1465.0000', cargada_en: '2026-09-25T12:00:00Z', cargada_por: null },
        productos_usd: 38,
        pendiente: { valor: 1490, expira_en: '2026-09-26T12:00:00Z' },
      },
      error: null,
    })
    await expect(leerEstadoCotizacion(cliente)).resolves.toEqual({
      vigente: { valor: 1465, cargadaEn: '2026-09-25T12:00:00Z', cargadaPor: null },
      productosUsd: 38,
      pendiente: { valor: 1490, expiraEn: '2026-09-26T12:00:00Z' },
    })
    expect(rpc).toHaveBeenCalledWith('estado_cotizacion')
  })

  it('estado_cotizacion sin vigente ni pendiente', async () => {
    const { cliente } = clienteCon({ data: { vigente: null, productos_usd: 0, pendiente: null }, error: null })
    await expect(leerEstadoCotizacion(cliente)).resolves.toEqual({ vigente: null, productosUsd: 0, pendiente: null })
  })

  it('un error de la base no se traga', async () => {
    const error = { code: '42501', message: 'sin permiso' }
    await expect(leerEstadoCotizacion(clienteCon({ data: null, error }).cliente)).rejects.toBe(error)
    await expect(cargarCotizacionRpc(clienteCon({ data: null, error }).cliente, 1490)).rejects.toBe(error)
  })

  it('cargar_cotizacion envía p_valor y mapea la respuesta', async () => {
    const { cliente, rpc } = clienteCon({
      data: { valor: 1490, anterior: 1465, variacion_pct: 1.7065, expira_en: '2026-09-26T12:00:00Z' },
      error: null,
    })
    await expect(cargarCotizacionRpc(cliente, 1490)).resolves.toEqual({
      valor: 1490, anterior: 1465, variacionPct: 1.7065, expiraEn: '2026-09-26T12:00:00Z',
    })
    expect(rpc).toHaveBeenCalledWith('cargar_cotizacion', { p_valor: 1490 })
  })

  it('cargar_cotizacion sin anterior devuelve nulos', async () => {
    const { cliente } = clienteCon({ data: { valor: 1000, anterior: null, variacion_pct: null, expira_en: 'x' }, error: null })
    await expect(cargarCotizacionRpc(cliente, 1000)).resolves.toMatchObject({ anterior: null, variacionPct: null })
  })
})
