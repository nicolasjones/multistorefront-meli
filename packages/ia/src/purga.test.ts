import { describe, expect, it, vi } from 'vitest'
import { purgarEvidenciasVencidas } from './index.js'

describe('purga de evidencias IA', () => {
  it('borra por Storage API y confirma metadatos sólo tras cada borrado', async () => {
    const eliminarEvidencia = vi.fn(async () => undefined); const finalizarPurga = vi.fn(async () => 2)
    await expect(purgarEvidenciasVencidas({ evidenciasPendientes: async () => [{ interaccionId: 'a', evidenciaPath: 'a.json' }, { interaccionId: 'b', evidenciaPath: 'b.json' }], eliminarEvidencia, finalizarPurga })).resolves.toBe(2)
    expect(eliminarEvidencia).toHaveBeenCalledWith('a.json'); expect(finalizarPurga).toHaveBeenCalledWith(['a', 'b'])
  })
  it('no confirma metadatos si Storage no logra borrar un objeto', async () => {
    const finalizarPurga = vi.fn(async () => 1)
    await expect(purgarEvidenciasVencidas({ evidenciasPendientes: async () => [{ interaccionId: 'a', evidenciaPath: 'a.json' }], eliminarEvidencia: async () => { throw new Error('STORAGE_FALLO') }, finalizarPurga })).rejects.toThrow('STORAGE_FALLO')
    expect(finalizarPurga).not.toHaveBeenCalled()
  })
})
