import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabaseClient: { rpc } }))

import { listarPresupuestos } from './ventasPresupuestos'

const base = { busqueda: '', estado: 'todos' as const, empresaId: null, pagina: 1, tamano: 10 }

describe('listarPresupuestos', () => {
  beforeEach(() => {
    rpc.mockReset()
    rpc.mockResolvedValue({ data: [], error: null })
  })

  it('manda p_origen nulo con «todos» o sin origen, y el canal elegido en los demás casos', async () => {
    await listarPresupuestos(base)
    await listarPresupuestos({ ...base, origen: 'todos' })
    await listarPresupuestos({ ...base, origen: 'tienda' })
    await listarPresupuestos({ ...base, origen: 'panel' })
    expect(rpc.mock.calls.map((c) => c[1].p_origen)).toEqual([null, null, 'tienda', 'panel'])
    expect(rpc.mock.calls[0][0]).toBe('listar_presupuestos')
  })

  it('el total sale de `filas` de la base (el filtro cuenta antes de paginar)', async () => {
    rpc.mockResolvedValue({ data: [{ id: 'p-1', numero: '1', total: '10', filas: '37' }], error: null })
    const pagina = await listarPresupuestos({ ...base, origen: 'tienda', pagina: 2 })
    expect(pagina.total).toBe(37)
    expect(pagina.presupuestos[0].total).toBe(10)
  })
})
