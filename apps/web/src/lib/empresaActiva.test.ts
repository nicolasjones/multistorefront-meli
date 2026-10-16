import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabaseClient: { rpc } }))

import { cambiarEmpresaActiva, listarEmpresasSelector } from './empresaActiva'

describe('empresaActiva (F-ROL-06)', () => {
  beforeEach(() => rpc.mockReset())

  it('mapea es_activa y rol_id de la RPC', async () => {
    rpc.mockResolvedValue({ data: [{ id: 'e-1', nombre: 'A', es_activa: true, rol_id: 'operador' }, { id: 'e-2', nombre: 'B', es_activa: false, rol_id: null }], error: null })
    expect(await listarEmpresasSelector()).toEqual([
      { id: 'e-1', nombre: 'A', esActiva: true, rolId: 'operador' },
      { id: 'e-2', nombre: 'B', esActiva: false, rolId: null },
    ])
    expect(rpc).toHaveBeenCalledWith('empresas_para_selector')
  })

  it('propaga el error de la RPC al cambiar', async () => {
    rpc.mockResolvedValue({ error: { message: 'sin acceso' } })
    await expect(cambiarEmpresaActiva('e-2')).rejects.toThrow('sin acceso')
    expect(rpc).toHaveBeenCalledWith('cambiar_empresa_activa', { p_empresa_id: 'e-2' })
  })
})
