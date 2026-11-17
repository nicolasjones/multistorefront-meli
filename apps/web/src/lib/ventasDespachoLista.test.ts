import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabaseClient: { rpc: vi.fn() } }))

import { CONTEOS_VACIOS, listarDespacho, normalizarConteos, VARIANTE_ESTADO_DESPACHO } from './ventasDespachoLista'
import { ESTADOS_DESPACHO } from './ventasDespacho'
import { supabaseClient } from './supabase'

const fila = (id: string | null, extra: Record<string, unknown> = {}) => ({
  id, numero: '0003-00001251', empresa_id: 'e1', empresa: 'Tienda', fecha: '2026-11-01', cliente: 'Ana',
  estado_despacho: 'armando', armo: null, controlo: null, entrego: null, transporte: null, guia: null, fecha_envio: null,
  puede_despachar: true, filas: 1, conteos: { armando: 1 }, ...extra,
})

describe('conteos del tablero de despacho', () => {
  it('completa con cero los estados que la base no informa', () => {
    expect(normalizarConteos({ armando: 2 })).toEqual({ ...CONTEOS_VACIOS, armando: 2 })
  })

  it('convierte a número los conteos que llegan como texto', () => {
    expect(normalizarConteos({ entregado: '7', sin_armar: 3 })).toMatchObject({ entregado: 7, sin_armar: 3 })
  })

  it('sin conteos (null) devuelve todo en cero y no comparte el objeto constante', () => {
    const conteos = normalizarConteos(null)
    expect(conteos).toEqual(CONTEOS_VACIOS)
    expect(conteos).not.toBe(CONTEOS_VACIOS)
  })

  it('todos los estados de despacho tienen conteo y tono', () => {
    for (const estado of ESTADOS_DESPACHO) {
      expect(CONTEOS_VACIOS[estado]).toBe(0)
      expect(VARIANTE_ESTADO_DESPACHO[estado]).toBeTruthy()
    }
  })
})

describe('lectura del tablero de despacho', () => {
  const filtros = { busqueda: '  guía 12 ', estado: null, empresaId: null, pagina: 1, tamano: 25 }

  it('manda la búsqueda recortada y vacía como null', async () => {
    vi.mocked(supabaseClient.rpc).mockResolvedValue({ data: [], error: null } as never)
    await listarDespacho(filtros)
    await listarDespacho({ ...filtros, busqueda: '   ' })
    expect(supabaseClient.rpc).toHaveBeenNthCalledWith(1, 'listar_despacho', expect.objectContaining({ p_busqueda: 'guía 12' }))
    expect(supabaseClient.rpc).toHaveBeenNthCalledWith(2, 'listar_despacho', expect.objectContaining({ p_busqueda: null }))
  })

  it('arma la página con el total, los conteos y las filas sin los campos auxiliares', async () => {
    vi.mocked(supabaseClient.rpc).mockResolvedValue({ data: [fila('f1', { filas: '30', conteos: { armando: '4' } })], error: null } as never)
    const pagina = await listarDespacho(filtros)
    expect(pagina.total).toBe(30)
    expect(pagina.conteos.armando).toBe(4)
    expect(pagina.filas).toHaveLength(1)
    expect(pagina.filas[0]).not.toHaveProperty('conteos')
    expect(pagina.filas[0]).not.toHaveProperty('filas')
    expect(pagina.filas[0].id).toBe('f1')
  })

  it('la fila sin facturas trae solo los conteos: no es una factura', async () => {
    vi.mocked(supabaseClient.rpc).mockResolvedValue({ data: [fila(null, { filas: 0, conteos: { entregado: 5 } })], error: null } as never)
    const pagina = await listarDespacho(filtros)
    expect(pagina.filas).toEqual([])
    expect(pagina.total).toBe(0)
    expect(pagina.conteos.entregado).toBe(5)
  })

  it('sin datos devuelve una página vacía y propaga el error de la base', async () => {
    vi.mocked(supabaseClient.rpc).mockResolvedValueOnce({ data: null, error: null } as never)
    expect(await listarDespacho(filtros)).toEqual({ filas: [], total: 0, conteos: CONTEOS_VACIOS })
    const error = { message: 'falló' }
    vi.mocked(supabaseClient.rpc).mockResolvedValueOnce({ data: null, error } as never)
    await expect(listarDespacho(filtros)).rejects.toBe(error)
  })
})
