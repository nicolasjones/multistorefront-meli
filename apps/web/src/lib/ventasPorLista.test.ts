import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { leerVentasPorLista, mensajeErrorVentasPorLista } from './ventasPorLista'

const rpc = vi.fn()
const cliente = { rpc } as unknown as SupabaseClient

describe('leerVentasPorLista', () => {
  beforeEach(() => rpc.mockReset())

  it('mapea las filas (numeric de texto a número) y la fila sin lista conserva nulos', async () => {
    rpc.mockResolvedValue({
      data: [
        { lista_id: 'l', lista_nombre: 'Revendedores', ajuste_pct_actual: '-20.00', comprobantes: '3', unidades: 2, ventas_netas: '800.00', ajuste_otorgado: '-200.00' },
        { lista_id: null, lista_nombre: null, ajuste_pct_actual: null, comprobantes: 1, unidades: 1, ventas_netas: 500, ajuste_otorgado: 0 },
      ],
      error: null,
    })
    await expect(leerVentasPorLista(cliente, { desde: '2026-10-01', hasta: '2026-10-31', empresaId: 'e-1' })).resolves.toEqual([
      { listaId: 'l', listaNombre: 'Revendedores', ajustePctActual: -20, comprobantes: 3, unidades: 2, ventasNetas: 800, ajusteOtorgado: -200 },
      { listaId: null, listaNombre: null, ajustePctActual: null, comprobantes: 1, unidades: 1, ventasNetas: 500, ajusteOtorgado: 0 },
    ])
    expect(rpc).toHaveBeenCalledWith('ventas_por_lista_precios', { p_desde: '2026-10-01', p_hasta: '2026-10-31', p_empresa_id: 'e-1' })
  })
  it('propaga el error de la base', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
    await expect(leerVentasPorLista(cliente, { desde: 'a', hasta: 'b', empresaId: null })).rejects.toEqual({ code: '42501' })
  })
  it('mensajes en castellano', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(mensajeErrorVentasPorLista({ code: '42501' })).toBe('Tu rol no puede ver las ventas por lista de precios.')
    expect(mensajeErrorVentasPorLista({ code: '22023' })).toBe('Revisá el período elegido: Desde no puede ser posterior a Hasta y el máximo es de 5 años.')
    expect(mensajeErrorVentasPorLista({ code: 'XX000', message: 'interno' })).toBe('No pudimos cargar las ventas por lista de precios.')
  })
})
