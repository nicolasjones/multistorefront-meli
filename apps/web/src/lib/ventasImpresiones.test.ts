import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabaseClient: { rpc } }))

import { formatearFechaMarca, registrarImpresion, textoMarca, ultimasImpresiones } from './ventasImpresiones'

beforeEach(() => vi.clearAllMocks())

describe('ventasImpresiones (F-VTA-21)', () => {
  it('formatea la marca «dd/mm hh:mm» en hora de Buenos Aires', () => {
    expect(formatearFechaMarca('2026-10-07T14:42:00Z')).toBe('07/10 11:42')
    expect(formatearFechaMarca('no es una fecha')).toBe('—')
  })

  it('arma el texto de la marca, con fecha si se imprimió y sin ella si nunca', () => {
    expect(textoMarca('factura', { impreso_en: '2026-10-07T14:42:00Z' })).toBe('Factura impresa · 07/10 11:42')
    expect(textoMarca('remito', undefined)).toBe('Remito impreso')
    expect(textoMarca('presupuesto', undefined)).toBe('Presupuesto impreso')
  })

  it('registra la impresión por la RPC con el documento', async () => {
    rpc.mockResolvedValue({ data: { id: 'i-1', reimpresion: true }, error: null })
    await expect(registrarImpresion('d-1')).resolves.toMatchObject({ id: 'i-1', reimpresion: true })
    expect(rpc).toHaveBeenCalledWith('registrar_impresion', { p_documento_id: 'd-1' })
  })

  it('propaga el error de la base al registrar', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'no está listo' } })
    await expect(registrarImpresion('d-1')).rejects.toMatchObject({ code: '22023' })
  })

  it('indexa por tipo la última impresión de cada documento', async () => {
    rpc.mockResolvedValue({
      data: [
        { id: 'i-1', tipo_documento: 'factura', impreso_en: '2026-10-07T14:42:00Z' },
        { id: 'i-2', tipo_documento: 'remito', impreso_en: '2026-10-08T12:05:00Z' },
      ],
      error: null,
    })
    const ultimas = await ultimasImpresiones('k-1')
    expect(rpc).toHaveBeenCalledWith('ultimas_impresiones_comprobante', { p_comprobante_id: 'k-1' })
    expect(Object.keys(ultimas).sort()).toEqual(['factura', 'remito'])
    expect(ultimas.remito?.id).toBe('i-2')
  })

  it('sin impresiones devuelve un objeto vacío y propaga el error de la base', async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null })
    await expect(ultimasImpresiones('k-1')).resolves.toEqual({})
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } })
    await expect(ultimasImpresiones('k-1')).rejects.toMatchObject({ code: '42501' })
  })
})
