import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), createSignedUrl: vi.fn(), from: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { rpc: mocks.rpc, storage: { from: mocks.from } } }))

import { descargarExportacionDiferida } from './exportarComprobantes'

describe('descargarExportacionDiferida (F-VTA-09, FR-010)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.from.mockReturnValue({ createSignedUrl: mocks.createSignedUrl })
  })

  it('firma una URL corta del bucket exportaciones-ventas y descarga cuando terminó', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ estado: 'exitosa', archivo: 'org/usr/ej-1.csv' }], error: null })
    mocks.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://x/firmada' }, error: null })
    const clic = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await descargarExportacionDiferida('ej-1', 'comprobantes-2026-10-25.csv')
    expect(mocks.rpc).toHaveBeenCalledWith('archivo_exportacion_comprobantes', { p_ejecucion_id: 'ej-1' })
    expect(mocks.from).toHaveBeenCalledWith('exportaciones-ventas')
    expect(mocks.createSignedUrl).toHaveBeenCalledWith('org/usr/ej-1.csv', 60, { download: 'comprobantes-2026-10-25.csv' })
    expect(clic).toHaveBeenCalledTimes(1)
  })

  it('avisa que sigue generándose y no firma nada', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ estado: 'en_curso', archivo: null }], error: null })
    await expect(descargarExportacionDiferida('ej-1', 'a.csv')).rejects.toThrow(/todavía se está generando/)
    expect(mocks.createSignedUrl).not.toHaveBeenCalled()
  })

  it('avisa si falló o venció y no firma nada', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ estado: 'fallida', archivo: null }], error: null })
    await expect(descargarExportacionDiferida('ej-1', 'a.csv')).rejects.toThrow(/no pudo completarse/)
    expect(mocks.createSignedUrl).not.toHaveBeenCalled()
  })

  it('avisa si no pudo firmar la URL', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ estado: 'exitosa', archivo: 'org/usr/ej-1.csv' }], error: null })
    mocks.createSignedUrl.mockResolvedValue({ data: null, error: new Error('x') })
    await expect(descargarExportacionDiferida('ej-1', 'a.csv')).rejects.toThrow(/preparar la descarga/)
  })
})
