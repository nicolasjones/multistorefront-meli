import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), createSignedUrl: vi.fn() }))

vi.mock('./supabase', () => ({
  supabaseClient: { rpc: mocks.rpc, storage: { from: () => ({ createSignedUrl: mocks.createSignedUrl }) } },
}))

import {
  ErrorDocumento,
  MENSAJE_ERROR_IMPRESION,
  MENSAJE_NO_CONFIRMADA,
  MENSAJE_TARDA,
  documentosElegibles,
  esCancelacion,
  esperarDocumento,
  mensajeDeErrorImpresion,
  motivoNoImprimible,
  obtenerDocumento,
  solicitarDocumento,
  urlFirmadaDocumento,
  type DocumentoComprobante,
} from './ventasImpresion'

const documento = (cambios: Partial<DocumentoComprobante> = {}): DocumentoComprobante => ({
  id: 'd-1', comprobante_id: 'k-1', empresa_id: 'e-1', tipo_documento: 'factura', estado: 'pendiente', ruta: null,
  error: null, solicitado_en: '2026-10-25T10:00:00Z', generado_en: null, ...cambios,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('elegibilidad (FR-002, FR-011, FR-012)', () => {
  it('una factura confirmada ofrece factura y remito', () => {
    expect(documentosElegibles({ tipo: 'factura', estado: 'confirmada' })).toEqual(['factura', 'remito'])
  })

  it.each(['borrador', 'pendiente'])('una factura en %s no ofrece nada y explica el motivo', (estado) => {
    expect(documentosElegibles({ tipo: 'factura', estado })).toEqual([])
    expect(motivoNoImprimible({ tipo: 'factura', estado })).toBe(MENSAJE_NO_CONFIRMADA)
  })

  it('un presupuesto no ofrece factura ni remito', () => {
    expect(documentosElegibles({ tipo: 'presupuesto', estado: 'pendiente' })).toEqual([])
    expect(motivoNoImprimible({ tipo: 'presupuesto', estado: 'pendiente' })).toBeNull()
  })
})

describe('llamadas a la base', () => {
  it('solicita el documento con las RPC del contrato', async () => {
    mocks.rpc.mockResolvedValue({ data: documento(), error: null })
    expect((await solicitarDocumento('k-1', 'remito')).id).toBe('d-1')
    expect(mocks.rpc).toHaveBeenCalledWith('solicitar_documento_comprobante', { p_comprobante_id: 'k-1', p_tipo_documento: 'remito' })
  })

  it('propaga el error de la base', async () => {
    const error = { code: '42501', message: 'x' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(solicitarDocumento('k-1', 'factura')).rejects.toBe(error)
    await expect(obtenerDocumento('d-1')).rejects.toBe(error)
  })

  it('firma la URL del PDF con vigencia corta', async () => {
    mocks.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://s/doc.pdf?t=1' }, error: null })
    expect(await urlFirmadaDocumento('o/e/c/d.pdf')).toBe('https://s/doc.pdf?t=1')
    expect(mocks.createSignedUrl).toHaveBeenCalledWith('o/e/c/d.pdf', 300)
  })
})

describe('esperarDocumento (FR-006)', () => {
  const esperar = vi.fn(async () => undefined)

  it('consulta hasta que el documento queda generado', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: documento(), error: null })
      .mockResolvedValueOnce({ data: documento({ estado: 'generado', ruta: 'o/e/c/d.pdf' }), error: null })
    const listo = await esperarDocumento('d-1', { esperar })
    expect(listo.ruta).toBe('o/e/c/d.pdf')
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
    expect(esperar).toHaveBeenCalledTimes(1)
  })

  it('un documento fallido lanza el motivo sanitizado', async () => {
    mocks.rpc.mockResolvedValue({ data: documento({ estado: 'fallido', error: 'No se pudo generar el documento' }), error: null })
    await expect(esperarDocumento('d-1', { esperar })).rejects.toThrow('No se pudo generar el documento')
  })

  it('pasado el tope avisa que tarda más de lo esperado', async () => {
    mocks.rpc.mockResolvedValue({ data: documento(), error: null })
    await expect(esperarDocumento('d-1', { esperar, intervaloMs: 1000, topeMs: 3000 })).rejects.toThrow(MENSAJE_TARDA)
    expect(mocks.rpc).toHaveBeenCalledTimes(3)
  })

  it('se cancela con la señal sin seguir consultando', async () => {
    const control = new AbortController()
    control.abort()
    const error = await esperarDocumento('d-1', { esperar, signal: control.signal }).catch((e: unknown) => e)
    expect(esCancelacion(error)).toBe(true)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})

describe('mensajeDeErrorImpresion', () => {
  it('traduce permiso, inexistente y validaciones de la base', () => {
    expect(mensajeDeErrorImpresion({ code: '42501' })).toMatch(/No tenés permiso/)
    expect(mensajeDeErrorImpresion({ code: 'P0002' })).toMatch(/no existe/)
    expect(mensajeDeErrorImpresion({ code: '22023', message: 'La factura tiene que estar confirmada para imprimirla' })).toBe(
      'La factura tiene que estar confirmada para imprimirla',
    )
    expect(mensajeDeErrorImpresion({ code: 'P0001', hint: 'sin_conexion', message: 'La impresión de documentos todavía no está habilitada' })).toMatch(
      /todavía no está habilitada/,
    )
  })

  it('un error desconocido no filtra detalle técnico', () => {
    expect(mensajeDeErrorImpresion({ code: 'XX000', message: 'relation dominio.x does not exist' })).toBe(MENSAJE_ERROR_IMPRESION)
    expect(mensajeDeErrorImpresion(new ErrorDocumento('motivo propio'))).toBe('motivo propio')
  })
})
