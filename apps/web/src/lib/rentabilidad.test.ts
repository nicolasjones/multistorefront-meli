import { describe, expect, it, vi } from 'vitest'
import {
  MENSAJE_CONFLICTO_UMBRAL,
  MENSAJE_UMBRAL_INVALIDO,
  guardarUmbralMargenBajo,
  hayProductosEnRiesgo,
  leerConteoMargen,
  leerUmbralMargenBajo,
  mensajeDeErrorRentabilidad,
  parsearEstadoInicial,
  parsearUmbralPct,
  rotuloMargenBajo,
  soloCaracteresDeUmbral,
  umbralATexto,
  urlParamsEstadoInicial,
} from './rentabilidad'

describe('parsearUmbralPct', () => {
  it('convierte el porcentaje del campo en fracción', () => {
    expect(parsearUmbralPct('10')).toBe(0.1)
    expect(parsearUmbralPct('12,5')).toBe(0.125)
    expect(parsearUmbralPct('100')).toBe(1)
    expect(parsearUmbralPct('0,01')).toBe(0.0001)
  })

  it('rechaza vacío, cero, mayor a 100, más de 2 decimales y no numérico', () => {
    for (const texto of ['', ' ', '0', '0,00', '100,01', '101', '12,345', 'abc', '-5', '1.5', ',5']) {
      expect(parsearUmbralPct(texto), texto).toBeNull()
    }
  })
})

describe('formato del umbral', () => {
  it('muestra el umbral en % y arma el rótulo del consolidado', () => {
    expect(umbralATexto(0.1)).toBe('10')
    expect(umbralATexto(0.125)).toBe('12,5')
    expect(rotuloMargenBajo(0.1)).toBe('Con margen bajo (< 10 %)')
    expect(rotuloMargenBajo(0.15)).toBe('Con margen bajo (< 15 %)')
  })

  it('el campo solo admite dígitos y coma', () => {
    expect(soloCaracteresDeUmbral('1a2.5,%3')).toBe('125,3')
  })
})

describe('mensajeDeErrorRentabilidad', () => {
  it('traduce el código de la base a un mensaje claro', () => {
    expect(mensajeDeErrorRentabilidad({ code: '42501' })).toBe('Tu rol no puede cambiar el umbral de margen bajo.')
    expect(mensajeDeErrorRentabilidad({ code: '23514' })).toBe(MENSAJE_UMBRAL_INVALIDO)
    expect(mensajeDeErrorRentabilidad({ code: '40001' })).toBe(MENSAJE_CONFLICTO_UMBRAL)
    expect(mensajeDeErrorRentabilidad({ code: 'XX000' })).toBe('No pudimos guardar el umbral. Intentá de nuevo.')
    expect(mensajeDeErrorRentabilidad(null)).toBe('No pudimos guardar el umbral. Intentá de nuevo.')
  })
})

describe('llamadas a la base', () => {
  it('lee el umbral por RPC y su updated_at de la configuración', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { updated_at: '2026-12-01T10:00:00Z' }, error: null })
    const cliente = {
      rpc: vi.fn().mockResolvedValue({ data: '0.1500', error: null }),
      schema: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ maybeSingle }) }) }),
    }
    await expect(leerUmbralMargenBajo(cliente as never)).resolves.toEqual({ umbral: 0.15, actualizadoEn: '2026-12-01T10:00:00Z' })
    expect(cliente.rpc).toHaveBeenCalledWith('leer_umbral_margen_bajo')
    expect(cliente.schema).toHaveBeenCalledWith('dominio')
  })

  it('sin fila de configuración el updated_at es nulo (rige el valor por defecto)', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const cliente = {
      rpc: vi.fn().mockResolvedValue({ data: 0.1, error: null }),
      schema: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ maybeSingle }) }) }),
    }
    await expect(leerUmbralMargenBajo(cliente as never)).resolves.toEqual({ umbral: 0.1, actualizadoEn: null })
  })

  it('propaga el error de la base al leer el umbral', async () => {
    const error = { code: '42501' }
    const cliente = {
      rpc: vi.fn().mockResolvedValue({ data: null, error }),
      schema: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) }),
    }
    await expect(leerUmbralMargenBajo(cliente as never)).rejects.toBe(error)
  })

  it('guarda el umbral con el updated_at para el bloqueo optimista', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: '2026-12-01T11:00:00Z', error: null })
    await expect(guardarUmbralMargenBajo({ rpc } as never, 0.15, '2026-12-01T10:00:00Z')).resolves.toBe('2026-12-01T11:00:00Z')
    expect(rpc).toHaveBeenCalledWith('guardar_umbral_margen_bajo', { p_umbral: 0.15, p_updated_at: '2026-12-01T10:00:00Z' })
  })

  it('propaga el error de la base al guardar', async () => {
    const error = { code: '40001' }
    const rpc = vi.fn().mockResolvedValue({ data: null, error })
    await expect(guardarUmbralMargenBajo({ rpc } as never, 0.2, null)).rejects.toBe(error)
  })

  it('lee el conteo (fila única o arreglo) y lo normaliza a números', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ con_margen_bajo: 2, con_margen_negativo: '1', productos_con_margen: 20 }], error: null })
    await expect(leerConteoMargen({ rpc } as never)).resolves.toEqual({ conMargenBajo: 2, conMargenNegativo: 1, productosConMargen: 20 })
    const vacio = vi.fn().mockResolvedValue({ data: [], error: null })
    await expect(leerConteoMargen({ rpc: vacio } as never)).resolves.toEqual({ conMargenBajo: 0, conMargenNegativo: 0, productosConMargen: 0 })
  })

  it('hayProductosEnRiesgo solo si hay bajos o negativos', () => {
    expect(hayProductosEnRiesgo({ conMargenBajo: 0, conMargenNegativo: 0, productosConMargen: 5 })).toBe(false)
    expect(hayProductosEnRiesgo({ conMargenBajo: 1, conMargenNegativo: 0, productosConMargen: 5 })).toBe(true)
    expect(hayProductosEnRiesgo({ conMargenBajo: 0, conMargenNegativo: 2, productosConMargen: 5 })).toBe(true)
  })
})

describe('filtro inicial de «Por producto»', () => {
  it('reconoce solo los estados de la lista cerrada', () => {
    expect(parsearEstadoInicial('bajo_o_negativo')).toBe('bajo_o_negativo')
    expect(parsearEstadoInicial('negativo')).toBe('negativo')
    for (const valor of [null, '', 'todos', 'toString', '__proto__', "Bajo'),(x"]) expect(parsearEstadoInicial(valor), String(valor)).toBeNull()
  })

  it('arma el rison de native_filters para el filtro Estado', () => {
    expect(urlParamsEstadoInicial(null)).toBeUndefined()
    expect(urlParamsEstadoInicial('bajo_o_negativo')).toEqual({
      native_filters:
        "(NATIVE_FILTER-estado:(extraFormData:(filters:!((col:estado_etiqueta,op:IN,val:!(Bajo,Negativo)))),filterState:(label:'Bajo, Negativo',value:!(Bajo,Negativo)),id:NATIVE_FILTER-estado,ownState:()))",
    })
    expect(urlParamsEstadoInicial('negativo')?.native_filters).toContain('val:!(Negativo)')
  })
})
