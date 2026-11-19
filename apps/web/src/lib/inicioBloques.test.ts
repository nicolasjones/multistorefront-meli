import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import {
  EVENTOS_RECIENTES, FILTROS_MOVIMIENTOS_INICIALES, formatoAjuste, formatoDia, leerActividadReciente, leerBloquesInicio, leerMovimientosPorProducto, ORDENES_MOVIMIENTOS,
} from './inicioBloques'

const contexto = { desde: '2026-11-01', hasta: '2026-11-17', empresaId: 'e1', depositoId: null }

describe('formatoAjuste', () => {
  it('muestra signo explícito con el menos tipográfico y cero plano', () => {
    expect(formatoAjuste(3)).toBe('+3')
    expect(formatoAjuste(-2)).toBe('−2')
    expect(formatoAjuste(0)).toBe('0')
  })
})

describe('formatoDia', () => {
  it('invierte el día sin pasar por Date (no corre por zona horaria)', () => {
    expect(formatoDia('2026-10-10')).toBe('10/10/2026')
    expect(formatoDia('2026-01-01')).toBe('01/01/2026')
  })

  it('un día ausente es un guion y uno mal formado se muestra tal cual', () => {
    expect(formatoDia(null)).toBe('—')
    expect(formatoDia('mañana')).toBe('mañana')
  })
})

describe('ordenes de movimientos', () => {
  it('no repiten claves y el orden inicial existe en la lista', () => {
    const claves = ORDENES_MOVIMIENTOS.map((o) => o.valor)
    expect(new Set(claves).size).toBe(claves.length)
    expect(claves).toContain(FILTROS_MOVIMIENTOS_INICIALES.orden)
  })
})

describe('lecturas', () => {
  beforeEach(() => mocks.rpc.mockReset())

  it('leerBloquesInicio pide una sola sección solo si se indica', async () => {
    mocks.rpc.mockResolvedValue({ data: { por_tienda: [], salidas_por_deposito: null }, error: null })
    await leerBloquesInicio(contexto)
    expect(mocks.rpc).toHaveBeenLastCalledWith('resumen_inicio_bloques', { p_desde: '2026-11-01', p_hasta: '2026-11-17', p_empresa: 'e1', p_deposito: null })
    await leerBloquesInicio(contexto, 'por_tienda')
    expect(mocks.rpc).toHaveBeenLastCalledWith('resumen_inicio_bloques', expect.objectContaining({ p_seccion: 'por_tienda' }))
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
    await expect(leerBloquesInicio(contexto)).rejects.toMatchObject({ code: '42501' })
  })

  it('leerActividadReciente pide los últimos eventos sin filtros de actor ni tipo y pasa a camelCase', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ id: 'a1', creado_en: 't', tipo: 'x', empresa_id: null, empresa_nombre: null, actor_id: 'u', actor_nombre: 'Ana', detalle: 'd' }], error: null })
    await expect(leerActividadReciente(contexto)).resolves.toEqual([
      { id: 'a1', creadoEn: 't', tipo: 'x', empresaId: null, empresaNombre: null, actorId: 'u', actorNombre: 'Ana', detalle: 'd' },
    ])
    expect(mocks.rpc).toHaveBeenCalledWith('listar_actividad', expect.objectContaining({ p_actor: null, p_tipo: null, p_pagina: 1, p_tamano: EVENTOS_RECIENTES }))
  })

  it('leerMovimientosPorProducto convierte números, deja la venta nula sin permiso y normaliza el SKU vacío', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ producto_id: 'p1', nombre: 'Cable', sku: '  ', categoria: 'Cables', stock_inicial: '10', entradas: '5', salidas: '3', ajustes: '-1', stock_actual: '11', minimo: '4', ventas: null, ultimo_movimiento: '2026-11-10', estado: 'normal', total: '42' }],
      error: null,
    })
    const { filas, total } = await leerMovimientosPorProducto(contexto, { ...FILTROS_MOVIMIENTOS_INICIALES, busqueda: ' cab ' }, 2, 25)
    expect(total).toBe(42)
    expect(filas[0]).toMatchObject({ productoId: 'p1', sku: null, stockInicial: 10, ajustes: -1, ventas: null, stockActual: 11 })
    expect(mocks.rpc).toHaveBeenCalledWith('movimientos_por_producto', expect.objectContaining({ p_busqueda: 'cab', p_pagina: 2, p_tamano: 25, p_vista: 'todos' }))
  })

  it('sin filas el total es 0 y la búsqueda en blanco viaja como null', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await expect(leerMovimientosPorProducto(contexto, FILTROS_MOVIMIENTOS_INICIALES, 1, 25)).resolves.toEqual({ filas: [], total: 0 })
    expect(mocks.rpc).toHaveBeenCalledWith('movimientos_por_producto', expect.objectContaining({ p_busqueda: null }))
  })
})
