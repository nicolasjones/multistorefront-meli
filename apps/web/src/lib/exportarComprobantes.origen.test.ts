import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { rpc: mocks.rpc, storage: { from: vi.fn() } } }))

import { exportarInmediato, solicitarExportacionDiferida } from './exportarComprobantes'
import { FILTROS_VACIOS } from './ventasComprobantes'

describe('exportación por canal', () => {
  beforeEach(() => mocks.rpc.mockReset())

  it('la vía inmediata manda p_origen solo cuando hay un canal elegido', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    await exportarInmediato('presupuestos', { ...FILTROS_VACIOS, origen: 'tienda' })
    expect(mocks.rpc).toHaveBeenLastCalledWith('exportar_comprobantes', expect.objectContaining({ p_tipo: 'presupuestos', p_origen: 'tienda' }))
    await exportarInmediato('presupuestos', { ...FILTROS_VACIOS, origen: '' })
    expect(mocks.rpc.mock.lastCall?.[1]).not.toHaveProperty('p_origen')
    await exportarInmediato('comprobantes', FILTROS_VACIOS)
    expect(mocks.rpc.mock.lastCall?.[1]).not.toHaveProperty('p_origen')
  })

  it('la vía diferida guarda el canal en los filtros de la solicitud', async () => {
    mocks.rpc.mockResolvedValue({ data: 'ej-1', error: null })
    await solicitarExportacionDiferida('presupuestos', { ...FILTROS_VACIOS, origen: 'panel' })
    expect(mocks.rpc).toHaveBeenLastCalledWith('solicitar_exportacion_comprobantes', {
      p_tipo: 'presupuestos',
      p_filtros: expect.objectContaining({ origen: 'panel' }),
    })
    await solicitarExportacionDiferida('presupuestos', FILTROS_VACIOS)
    expect(mocks.rpc.mock.lastCall?.[1].p_filtros).not.toHaveProperty('origen')
  })
})
