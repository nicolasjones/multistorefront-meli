import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { checkFeatureHabilitada } from './features'

describe('checkFeatureHabilitada', () => {
  beforeEach(() => mocks.rpc.mockReset())

  it('consulta la RPC pública con el id de la funcionalidad', async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null })
    await expect(checkFeatureHabilitada('stock')).resolves.toBe(true)
    expect(mocks.rpc).toHaveBeenCalledWith('tiene_feature_publica', { p_feature_id: 'stock' })
  })

  it('falla cerrado: ante un error de red no habilita nada', async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: { message: 'red' } })
    await expect(checkFeatureHabilitada('stock')).resolves.toBe(false)
  })

  it('un resultado vacío o falso queda deshabilitado', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await expect(checkFeatureHabilitada('stock')).resolves.toBe(false)
  })
})
