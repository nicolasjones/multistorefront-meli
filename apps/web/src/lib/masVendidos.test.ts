import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import {
  ATAJOS_PERIODO, TAMANO_PAGINA_MAS_VENDIDOS, listarMasVendidos, normalizarFilaMasVendido, periodoInicial,
  rangoDeAtajo, validarRango,
} from './masVendidos'

const filaServidor = () => ({
  posicion: 1,
  producto_id: 'p-1',
  nombre: 'Auricular',
  sku: 'AUR-1',
  unidades: 5,
  total_filas: 4,
})

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('listarMasVendidos (FR-402, FR-405: la RPC con período, tienda y página)', () => {
  it('llama a productos_mas_vendidos con el período, la tienda y la página', async () => {
    mocks.rpc.mockResolvedValue({ data: [filaServidor()], error: null })

    const resultado = await listarMasVendidos({ desde: '2026-10-01', hasta: '2026-10-31', empresaId: 'e-1', pagina: 2 })

    expect(mocks.rpc).toHaveBeenCalledWith('productos_mas_vendidos', {
      p_desde: '2026-10-01',
      p_hasta: '2026-10-31',
      p_empresa_id: 'e-1',
      p_pagina: 2,
      p_tamano: TAMANO_PAGINA_MAS_VENDIDOS,
    })
    expect(resultado.filas).toEqual([{ posicion: 1, producto_id: 'p-1', nombre: 'Auricular', sku: 'AUR-1', unidades: 5 }])
    expect(resultado.total).toBe(4)
  })

  it('sin tienda elegida no filtra por empresa', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    await listarMasVendidos({ desde: '2026-10-01', hasta: '2026-10-31', empresaId: null, pagina: 1 })
    expect(mocks.rpc).toHaveBeenCalledWith('productos_mas_vendidos', expect.objectContaining({ p_empresa_id: null }))
  })

  it('normaliza los números que llegan como texto (bigint) y el SKU vacío', () => {
    const fila = normalizarFilaMasVendido({
      posicion: '2', producto_id: 'p-2', nombre: 'Cable', sku: null, unidades: '3', total_filas: '9',
    })
    expect(fila).toEqual({ posicion: 2, producto_id: 'p-2', nombre: 'Cable', sku: null, unidades: 3 })
  })

  it('sin filas devuelve la lista vacía y total cero', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    expect(await listarMasVendidos({ desde: '2026-10-01', hasta: '2026-10-31', empresaId: null, pagina: 1 }))
      .toEqual({ filas: [], total: 0 })
  })

  it('un período inválido no sale a la base y dice qué corregir', async () => {
    await expect(listarMasVendidos({ desde: '2026-10-31', hasta: '2026-10-01', empresaId: null, pagina: 1 }))
      .rejects.toThrow('Hasta no puede ser anterior a Desde.')
    await expect(listarMasVendidos({ desde: '', hasta: '2026-10-01', empresaId: null, pagina: 1 }))
      .rejects.toThrow('Indicá la fecha Desde.')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('un permiso insuficiente lo dice; otro fallo, que pruebe de nuevo', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'sin permiso' } })
    await expect(listarMasVendidos({ desde: '2026-10-01', hasta: '2026-10-31', empresaId: null, pagina: 1 }))
      .rejects.toThrow('No tenés permiso para ver los productos más vendidos.')

    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'rango' } })
    await expect(listarMasVendidos({ desde: '2026-10-01', hasta: '2026-10-31', empresaId: null, pagina: 1 }))
      .rejects.toThrow('El período elegido no es válido.')

    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'boom' } })
    await expect(listarMasVendidos({ desde: '2026-10-01', hasta: '2026-10-31', empresaId: null, pagina: 1 }))
      .rejects.toThrow('No pudimos cargar los productos más vendidos. Probá de nuevo.')
  })
})

describe('período del reporte (FR-404: los atajos y el rango del ranking de clientes)', () => {
  it('ofrece los cuatro atajos: Este mes, Mes anterior, Últimos 90 días y Año en curso', () => {
    expect(ATAJOS_PERIODO.map((atajo) => atajo.etiqueta))
      .toEqual(['Este mes', 'Mes anterior', 'Últimos 90 días', 'Año en curso'])
  })

  it('el período por defecto es el mes en curso, en la zona de la organización', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-15T15:00:00Z'))
    expect(periodoInicial()).toEqual({ desde: '2026-10-01', hasta: '2026-10-15' })
  })

  it('los atajos resuelven el mismo rango que el ranking de clientes', () => {
    const ahora = new Date('2026-10-15T15:00:00Z')
    expect(rangoDeAtajo('mes-anterior', ahora)).toEqual({ desde: '2026-09-01', hasta: '2026-09-30' })
    expect(rangoDeAtajo('ultimos-90-dias', ahora)).toEqual({ desde: '2026-07-18', hasta: '2026-10-15' })
    expect(rangoDeAtajo('anio-en-curso', ahora)).toEqual({ desde: '2026-01-01', hasta: '2026-10-15' })
  })

  it('el rango se valida con el mismo máximo de 5 años', () => {
    expect(validarRango({ desde: '2021-10-15', hasta: '2026-10-15' })).toEqual({})
    expect(validarRango({ desde: '2021-10-15', hasta: '2026-10-16' }).hasta).toBe('El rango máximo es de 5 años.')
  })
})
