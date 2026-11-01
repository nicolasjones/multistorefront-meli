import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { armarCsv } from './exportarCsv'
import { COLUMNAS, pedirLoteReparaciones, TAMANO_LOTE_REPARACIONES } from './exportarReparaciones'
import type { ReparacionListada } from './reparacionesListado'

const fila = (n: number, extra: Partial<ReparacionListada> = {}): ReparacionListada => ({
  id: `r-${n}`, numero: n, codigo: `R-${String(n).padStart(4, '0')}`, ingreso_en: '2026-10-05',
  empresa_id: 'e-1', empresa: 'San Javucho', cliente: `Cliente ${n}`, equipo: 'Nintendo Switch', modelo: 'Estándar',
  numero_serie: `SN-${n}`, estado: 'En reparación', estado_tono: 'info', tecnico_id: 't-1', tecnico: 'Ana Pérez',
  entrega_prevista: '2026-10-25', total_cliente: 15000, pendientes_stock: 0, ...extra,
})

const FILTROS = { empresaId: 'e-1', periodo: 'semana' as const, serie: ' abc ', tecnicoId: 't-2' }

describe('exportarReparaciones (F-SVC-23, FR-060/FR-061)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('tiene exactamente las nueve columnas del listado, sin costos ni ganancia', () => {
    expect(COLUMNAS.map((columna) => columna.encabezado)).toEqual([
      'Reparación', 'Tienda', 'Cliente', 'Equipo', 'N.º de serie', 'Estado', 'Técnico', 'Entrega', 'Total',
    ])
    expect(COLUMNAS.map((columna) => columna.encabezado).join(' ')).not.toMatch(/costo|ganancia/i)
  })

  it('los valores salen como se ven en la tabla', () => {
    const csv = armarCsv(COLUMNAS, [fila(7), fila(8, { numero_serie: null, tecnico: null, entrega_prevista: null, total_cliente: 0 })]).split('\r\n')
    expect(csv[1]).toMatch(/^R-0007;San Javucho;Cliente 7;Nintendo Switch Estándar;SN-7;En reparación;Ana Pérez;25\/10\/2026;.*15\.000/)
    expect(csv[2]).toBe('R-0008;San Javucho;Cliente 8;Nintendo Switch Estándar;—;En reparación;—;—;A presupuestar')
  })

  it('neutraliza un texto que empieza como fórmula', () => {
    const csv = armarCsv(COLUMNAS, [fila(1, { cliente: '=HYPERLINK("x")' })])
    expect(csv).toContain("'=HYPERLINK")
  })

  it('no usa ninguna RPC nueva: pide listar_reparaciones con los filtros y el lote de 200', async () => {
    mocks.rpc.mockResolvedValue({ data: { total_filas: 1, filas: [fila(1)] }, error: null })
    await pedirLoteReparaciones(FILTROS, 0, TAMANO_LOTE_REPARACIONES)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('listar_reparaciones', {
      p_empresa: 'e-1', p_periodo: 'semana', p_serie: 'abc', p_tecnico: 't-2', p_pagina: 1, p_tamano: 200,
    })
  })

  it('traduce la posición a página y recorta el lote pedido', async () => {
    const pagina = Array.from({ length: 200 }, (_, i) => fila(i + 1))
    mocks.rpc.mockResolvedValue({ data: { total_filas: 500, filas: pagina }, error: null })
    const lote = await pedirLoteReparaciones(FILTROS, 400, 1)
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_pagina: 3 })
    expect(lote).toHaveLength(1)
    const medio = await pedirLoteReparaciones(FILTROS, 250, 10)
    expect(mocks.rpc.mock.calls[1][1]).toMatchObject({ p_pagina: 2 })
    expect(medio.map((f) => f.id)).toEqual(pagina.slice(50, 60).map((f) => f.id))
  })

  it('propaga el error de la RPC (nada se descarga)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'sin permiso' } })
    await expect(pedirLoteReparaciones(FILTROS, 0, 200)).rejects.toMatchObject({ code: '42501' })
  })
})
