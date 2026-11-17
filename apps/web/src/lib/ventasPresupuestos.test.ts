import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabaseClient: { rpc } }))

import { listarPresupuestos, mensajeDeAceptarPresupuesto } from './ventasPresupuestos'

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

describe('mensajeDeAceptarPresupuesto', () => {
  it('muestra el texto de la RPC cuando el presupuesto está vencido o ya no se acepta', () => {
    const vencido = { code: '55000', message: 'El presupuesto está vencido y no se puede aceptar' }
    expect(mensajeDeAceptarPresupuesto(vencido, 'x')).toBe('El presupuesto está vencido y no se puede aceptar')
    // Texto con cola del servidor: se devuelve la constante, no el mensaje crudo.
    expect(mensajeDeAceptarPresupuesto({ ...vencido, message: `${vencido.message} (id 123)` }, 'x')).toBe(vencido.message)
    const otro = { code: '55000', message: 'Este presupuesto ya no se puede aceptar' }
    expect(mensajeDeAceptarPresupuesto(otro, 'x')).toBe(otro.message)
  })

  it('un 55000 con texto desconocido no filtra el mensaje crudo y cae al genérico de comprobantes', () => {
    expect(mensajeDeAceptarPresupuesto({ code: '55000', message: 'relation x' }, 'x')).toMatch(/cerrado/)
  })
})
