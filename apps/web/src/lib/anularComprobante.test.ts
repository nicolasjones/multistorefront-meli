import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import {
  MENSAJE_CONFLICTO_ANULAR, MENSAJE_ERROR_ANULAR, MENSAJE_MOTIVO_LARGO, MENSAJE_MOTIVO_OBLIGATORIO, MOTIVO_ANULACION_MAXIMO,
  anularComprobante, esConflictoDeAnulacion, mensajeDeAnulacion, validarMotivoAnulacion,
} from './anularComprobante'

describe('validarMotivoAnulacion', () => {
  it('exige motivo y respeta el máximo sin contar espacios de los bordes', () => {
    expect(validarMotivoAnulacion('  ')).toBe(MENSAJE_MOTIVO_OBLIGATORIO)
    expect(validarMotivoAnulacion(` ${'a'.repeat(MOTIVO_ANULACION_MAXIMO)} `)).toBeNull()
    expect(validarMotivoAnulacion('a'.repeat(MOTIVO_ANULACION_MAXIMO + 1))).toBe(MENSAJE_MOTIVO_LARGO)
  })
})

describe('mensajeDeAnulacion', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => vi.restoreAllMocks())

  it('detecta el conflicto de concurrencia (40001)', () => {
    expect(esConflictoDeAnulacion({ code: '40001' })).toBe(true)
    expect(esConflictoDeAnulacion({ code: '42501' })).toBe(false)
    expect(esConflictoDeAnulacion(null)).toBe(false)
    expect(mensajeDeAnulacion({ code: '40001' })).toBe(MENSAJE_CONFLICTO_ANULAR)
  })

  it('traduce los mensajes en castellano de la RPC con un texto FIJO (nunca el message del servidor)', () => {
    const mensaje = 'La factura ya está cobrada: corregila con una nota de crédito'
    expect(mensajeDeAnulacion({ code: '55000', message: `${mensaje} (detalle interno del servidor)` })).toBe(mensaje)
  })

  // Guardas nuevas de `anular_comprobante` (migración 20270507180000, #1136): antes caían al error genérico.
  it('factura con despacho entregado: corregí con nota de crédito o RMA (55000)', () => {
    expect(mensajeDeAnulacion({ code: '55000', message: 'La factura ya fue entregada: corregí con nota de crédito o RMA' }))
      .toBe('La factura ya fue entregada: corregí con nota de crédito o RMA')
  })

  it('factura con cobros registrados: revertí el cobro primero (55000)', () => {
    expect(mensajeDeAnulacion({ code: '55000', message: 'La factura tiene cobros registrados: revertí el cobro o corregila con una nota de crédito' }))
      .toBe('La factura tiene cobros registrados: revertí el cobro o corregila con una nota de crédito')
  })

  it('un texto con el prefijo conocido pero con datos añadidos devuelve la constante, no el mensaje', () => {
    expect(mensajeDeAnulacion({ code: '55000', message: 'La factura ya fue entregada: corregí con nota de crédito o RMA — id interno 123' }))
      .not.toContain('123')
    expect(mensajeDeAnulacion({ code: '22023', message: 'El motivo «Venta de factura» existe pero está inactivo o no aplica a salidas: x' })).not.toContain('Venta de factura')
  })

  it('no expone el texto técnico de un 42501 de PostgREST', () => {
    expect(mensajeDeAnulacion({ code: '42501', message: 'permission denied for function anular_comprobante' })).toBe(MENSAJE_ERROR_ANULAR)
  })

  it('traduce comprobante inexistente y cae al mensaje genérico en el resto', () => {
    expect(mensajeDeAnulacion({ code: 'P0002' })).toMatch(/no existe/)
    expect(mensajeDeAnulacion(new Error('red'))).toBe(MENSAJE_ERROR_ANULAR)
  })
})

describe('anularComprobante', () => {
  beforeEach(() => mocks.rpc.mockReset())

  it('manda el motivo recortado y devuelve estado y fecha', async () => {
    mocks.rpc.mockResolvedValue({ data: { estado: 'anulado', updated_at: '2026-11-17T10:00:00Z', extra: 1 }, error: null })
    await expect(anularComprobante('c1', '  error de carga ', 'v0')).resolves.toEqual({ estado: 'anulado', updated_at: '2026-11-17T10:00:00Z' })
    expect(mocks.rpc).toHaveBeenCalledWith('anular_comprobante', { p_id: 'c1', p_motivo: 'error de carga', p_actualizado_en: 'v0' })
  })

  it('propaga el error y rechaza una respuesta incompleta', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '40001' } })
    await expect(anularComprobante('c1', 'x', 'v0')).rejects.toMatchObject({ code: '40001' })
    mocks.rpc.mockResolvedValue({ data: { estado: 'anulado' }, error: null })
    await expect(anularComprobante('c1', 'x', 'v0')).rejects.toThrow(/no devolvió/)
  })
})
