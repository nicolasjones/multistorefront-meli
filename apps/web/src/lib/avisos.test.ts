import { describe, expect, it, vi } from 'vitest'
import { MENSAJE_ERROR_GUARDADO_AVISO, guardarPreferenciaAviso, listarPreferenciasAviso, mensajeDeErrorAviso } from './avisos'

describe('mensajeDeErrorAviso', () => {
  it('distingue sin acceso, tipo inexistente y cualquier otro error', () => {
    expect(mensajeDeErrorAviso({ code: '42501' })).toMatch(/No tenés acceso/)
    expect(mensajeDeErrorAviso({ code: '22023' })).toMatch(/ya no existe/)
    expect(mensajeDeErrorAviso({ code: 'XX000' })).toBe(MENSAJE_ERROR_GUARDADO_AVISO)
    expect(mensajeDeErrorAviso(null)).toBe(MENSAJE_ERROR_GUARDADO_AVISO)
  })
})

describe('listarPreferenciasAviso', () => {
  it('se queda solo con tipo, nombre y activo de cada fila', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ tipo: 'stock_bajo', nombre: 'Stock bajo', activo: true, extra: 'x' }], error: null })
    await expect(listarPreferenciasAviso({ rpc } as never)).resolves.toEqual([{ tipo: 'stock_bajo', nombre: 'Stock bajo', activo: true }])
    expect(rpc).toHaveBeenCalledWith('listar_preferencias_aviso')
  })

  it('devuelve lista vacía si no hay datos y propaga el error de la base', async () => {
    await expect(listarPreferenciasAviso({ rpc: async () => ({ data: null, error: null }) } as never)).resolves.toEqual([])
    await expect(listarPreferenciasAviso({ rpc: async () => ({ data: null, error: { code: '42501' } }) } as never)).rejects.toMatchObject({ code: '42501' })
  })
})

describe('guardarPreferenciaAviso', () => {
  it('manda el tipo y el estado y devuelve el error sin lanzarlo', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { code: '22023' } })
    await expect(guardarPreferenciaAviso({ rpc } as never, 'stock_bajo', false)).resolves.toEqual({ error: { code: '22023' } })
    expect(rpc).toHaveBeenCalledWith('guardar_preferencia_aviso', { p_tipo: 'stock_bajo', p_activo: false })
  })
})
