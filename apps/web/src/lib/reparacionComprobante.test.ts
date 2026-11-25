import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import {
  MENSAJE_ERROR_CARGAR_COMPROBANTE, MENSAJE_ERROR_GENERAR, MENSAJE_REPARACION_ANULADA, MENSAJE_REPARACION_INEXISTENTE, MENSAJE_SIN_PERMISO_GENERAR,
  generarComprobanteDeReparacion, mensajeDeCargarComprobante, mensajeDeGenerarComprobante, obtenerComprobanteDeReparacion,
} from './reparacionComprobante'

describe('mensajeDeGenerarComprobante', () => {
  it('muestra el mensaje de la RPC solo si empieza con un prefijo conocido', () => {
    expect(mensajeDeGenerarComprobante({ code: '22023', message: 'La reparación no tiene ítems para cobrar.' })).toBe('La reparación no tiene ítems para cobrar.')
    expect(mensajeDeGenerarComprobante({ code: '22023', message: 'invalid input syntax' })).toBe(MENSAJE_ERROR_GENERAR)
  })

  it('traduce sin permiso, anulada e inexistente por código', () => {
    expect(mensajeDeGenerarComprobante({ code: '42501', message: 'permission denied for function x' })).toBe(MENSAJE_SIN_PERMISO_GENERAR)
    expect(mensajeDeGenerarComprobante({ code: '55000' })).toBe(MENSAJE_REPARACION_ANULADA)
    expect(mensajeDeGenerarComprobante({ code: 'P0002' })).toBe(MENSAJE_REPARACION_INEXISTENTE)
    expect(mensajeDeGenerarComprobante(null)).toBe(MENSAJE_ERROR_GENERAR)
  })
})

describe('mensajeDeCargarComprobante', () => {
  it('distingue inexistente, sin permiso y error genérico', () => {
    expect(mensajeDeCargarComprobante({ code: 'P0002' })).toBe(MENSAJE_REPARACION_INEXISTENTE)
    expect(mensajeDeCargarComprobante({ code: '42501' })).toMatch(/no puede ver/)
    expect(mensajeDeCargarComprobante(new Error('x'))).toBe(MENSAJE_ERROR_CARGAR_COMPROBANTE)
  })
})

describe('llamadas a la base', () => {
  beforeEach(() => mocks.rpc.mockReset())

  it('obtenerComprobanteDeReparacion convierte el total a número y devuelve null si no hay comprobante', async () => {
    mocks.rpc.mockResolvedValue({ data: { id: 'c', numero: 'A-1', tipo: 'factura', estado: 'emitida', total: '1250.50', empresa_id: 'e', empresa: 'Tienda' }, error: null })
    await expect(obtenerComprobanteDeReparacion('r1')).resolves.toMatchObject({ total: 1250.5 })
    expect(mocks.rpc).toHaveBeenCalledWith('comprobante_de_reparacion', { p_reparacion: 'r1' })
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await expect(obtenerComprobanteDeReparacion('r1')).resolves.toBeNull()
  })

  it('generarComprobanteDeReparacion devuelve el resultado y propaga errores', async () => {
    mocks.rpc.mockResolvedValue({ data: { comprobante_id: 'c', creado: true }, error: null })
    await expect(generarComprobanteDeReparacion('r1')).resolves.toEqual({ comprobante_id: 'c', creado: true })
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '55000' } })
    await expect(generarComprobanteDeReparacion('r1')).rejects.toMatchObject({ code: '55000' })
    await expect(obtenerComprobanteDeReparacion('r1').catch(() => 'x')).resolves.toBe('x')
  })
})

describe('reparación inexistente: código viejo y nuevo', () => {
  it.each(['P0002', 'PT404'])('el código %s se traduce al cargar y al generar el comprobante', (code) => {
    expect(mensajeDeCargarComprobante({ code })).toBe(MENSAJE_REPARACION_INEXISTENTE)
    expect(mensajeDeGenerarComprobante({ code })).toBe(MENSAJE_REPARACION_INEXISTENTE)
  })
})
