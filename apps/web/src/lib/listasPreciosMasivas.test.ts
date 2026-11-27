import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  TOPE_ASIGNACION_MASIVA,
  asignarListaMasiva,
  asignarListaTipo,
  leerListasDeClientesParaExportar,
  leerListasPorTipo,
  mensajeErrorLista,
  textoResultadoMasivo,
} from './listasPrecios'

const rpc = vi.fn()
const select = vi.fn()
const cliente = { rpc, from: vi.fn(() => ({ select })) } as unknown as SupabaseClient
const filtro = { texto: '  norte ', tipo: 'mayorista' as const, empresaId: 'e-1', conCuentaWeb: true }

describe('asignarListaMasiva', () => {
  beforeEach(() => {
    rpc.mockReset()
    rpc.mockResolvedValue({ data: [{ asignados: 2, sin_cambios: 1, omitidos: 3 }], error: null })
  })

  it('por selección envía los ids y deja los filtros en nulo', async () => {
    await expect(asignarListaMasiva(cliente, 'l-1', { clientes: ['c-1', 'c-2'] })).resolves.toEqual({ asignados: 2, sinCambios: 1, omitidos: 3 })
    expect(rpc).toHaveBeenCalledWith('asignar_lista_precios_masiva', {
      p_lista: 'l-1', p_clientes: ['c-1', 'c-2'], p_texto: null, p_tipo: null, p_empresa_id: null, p_con_cuenta_web: false,
    })
  })
  it('por filtro envía los criterios (texto recortado) y no los ids', async () => {
    await asignarListaMasiva(cliente, 'l-1', { filtro })
    expect(rpc).toHaveBeenCalledWith('asignar_lista_precios_masiva', {
      p_lista: 'l-1', p_clientes: null, p_texto: 'norte', p_tipo: 'mayorista', p_empresa_id: 'e-1', p_con_cuenta_web: true,
    })
  })
  it('quitar la lista envía p_lista nulo y un texto vacío viaja como nulo', async () => {
    await asignarListaMasiva(cliente, null, { filtro: { ...filtro, texto: '   ' } })
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_lista: null, p_texto: null })
  })
  it('propaga el error y rechaza una respuesta vacía', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '54000' } })
    await expect(asignarListaMasiva(cliente, 'l-1', { clientes: [] })).rejects.toEqual({ code: '54000' })
    rpc.mockResolvedValueOnce({ data: [], error: null })
    await expect(asignarListaMasiva(cliente, 'l-1', { clientes: [] })).rejects.toThrow('no devolvió resultado')
  })
})

describe('textoResultadoMasivo', () => {
  it.each([
    [{ asignados: 1, sinCambios: 0, omitidos: 0 }, 'L', 'Lista «L» asignada a 1 cliente.'],
    [{ asignados: 2, sinCambios: 0, omitidos: 0 }, 'L', 'Lista «L» asignada a 2 clientes.'],
    [{ asignados: 2, sinCambios: 1, omitidos: 0 }, 'L', 'Lista «L» asignada a 2 clientes. 1 ya estaba con ese valor.'],
    [{ asignados: 2, sinCambios: 3, omitidos: 1 }, 'L', 'Lista «L» asignada a 2 clientes. 3 ya estaban con ese valor. 1 se omitió (archivados, Consumidor final o que ya no existen).'],
    [{ asignados: 0, sinCambios: 0, omitidos: 4 }, null, 'Lista quitada a 0 clientes. 4 se omitieron (archivados, Consumidor final o que ya no existen).'],
  ])('%j', (resultado, nombre, esperado) => {
    expect(textoResultadoMasivo(resultado, nombre)).toBe(esperado)
  })
})

describe('listas por tipo', () => {
  beforeEach(() => {
    rpc.mockReset()
    select.mockReset()
  })

  it('leerListasPorTipo mapea la vista', async () => {
    select.mockReturnValue({ returns: async () => ({ data: [{ tipo: 'minorista', lista_precio_id: 'l', lista_nombre: 'Gremio', ajuste_pct: '-10.00', archivada_en: null }], error: null }) })
    await expect(leerListasPorTipo(cliente)).resolves.toEqual([{ tipo: 'minorista', listaId: 'l', listaNombre: 'Gremio', ajustePct: -10, archivadaEn: null }])
  })
  it('asignarListaTipo envía tipo y lista (nula = quitar)', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await asignarListaTipo(cliente, 'mayorista', 'l')
    await asignarListaTipo(cliente, 'mayorista', null)
    expect(rpc).toHaveBeenNthCalledWith(1, 'asignar_lista_precios_tipo_cliente', { p_tipo: 'mayorista', p_lista: 'l' })
    expect(rpc).toHaveBeenNthCalledWith(2, 'asignar_lista_precios_tipo_cliente', { p_tipo: 'mayorista', p_lista: null })
  })
})

describe('leerListasDeClientesParaExportar', () => {
  beforeEach(() => rpc.mockReset())

  it('sin ids no consulta', async () => {
    await expect(leerListasDeClientesParaExportar(cliente, [])).resolves.toEqual(new Map())
    expect(rpc).not.toHaveBeenCalled()
  })
  it('marca la lista heredada del tipo y deja la propia tal cual', async () => {
    rpc.mockResolvedValue({ data: [{ cliente_id: 'a', lista_nombre: 'Propia', origen: 'cliente' }, { cliente_id: 'b', lista_nombre: 'Gremio', origen: 'tipo' }], error: null })
    const mapa = await leerListasDeClientesParaExportar(cliente, ['a', 'b', 'c'])
    expect([...mapa]).toEqual([['a', 'Propia'], ['b', 'Gremio (por tipo de cliente)']])
    expect(rpc).toHaveBeenCalledWith('listas_de_clientes_para_exportar', { p_clientes: ['a', 'b', 'c'] })
  })
})

describe('mensajeErrorLista · tope', () => {
  it('54000 nombra el tope', () => {
    expect(mensajeErrorLista({ code: '54000' }, 'x')).toBe(`Se pueden asignar hasta ${TOPE_ASIGNACION_MASIVA} clientes por vez: afiná la selección o el filtro.`)
  })
  it('el tope es 5000 (coincide con la base)', () => {
    expect(TOPE_ASIGNACION_MASIVA).toBe(5000)
  })
})
