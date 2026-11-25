import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import {
  MENSAJE_CONFLICTO, codigoDeError, listarContrarreembolsos, marcarContrarreembolsoCobrado, mensajeDeErrorContrarreembolso, puedeCobrarContrarreembolso, resumenContrarreembolsos,
} from './contrarreembolsos'

beforeEach(() => { mocks.rpc.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => vi.restoreAllMocks())

describe('mensajes de error', () => {
  it('codigoDeError nunca expone el detalle crudo', () => {
    expect(codigoDeError({ code: '42501', message: 'policy x on table y' })).toBe('42501')
    expect(codigoDeError(null)).toBe('sin código')
  })

  it('traduce por código y deja pasar solo el mensaje de validación 22023', () => {
    expect(mensajeDeErrorContrarreembolso({ code: '40001' }, 'x')).toBe(MENSAJE_CONFLICTO)
    expect(mensajeDeErrorContrarreembolso({ code: 'PT412' }, 'x')).toBe(MENSAJE_CONFLICTO)
    expect(mensajeDeErrorContrarreembolso({ code: 'PT404' }, 'x')).toMatch(/no existe/)
    expect(mensajeDeErrorContrarreembolso({ code: '42501', message: 'policy' }, 'x')).toMatch(/Tu rol no puede cobrar/)
    expect(mensajeDeErrorContrarreembolso({ code: '55000' }, 'x')).toMatch(/anulada/)
    expect(mensajeDeErrorContrarreembolso({ code: 'P0002' }, 'x')).toMatch(/no existe/)
    expect(mensajeDeErrorContrarreembolso({ code: '22023', message: 'Importe inválido' }, 'x')).toBe('Importe inválido')
    expect(mensajeDeErrorContrarreembolso({ code: 'XX000', message: 'tabla secreta' }, 'por defecto')).toBe('por defecto')
  })
})

describe('listarContrarreembolsos', () => {
  it('descarta estados inventados, convierte importes y toma el total de la primera fila', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ id: 'c1', importe: '1500.5', filas: '7' }, { id: 'c2', importe: 20, filas: '7' }], error: null })
    const pagina = await listarContrarreembolsos({ empresaId: null, estado: 'raro' as never, pagina: 1, tamano: 10 })
    expect(mocks.rpc).toHaveBeenCalledWith('listar_contrarreembolsos', { p_empresa_id: null, p_estado: null, p_pagina: 1, p_tamano: 10 })
    expect(pagina.total).toBe(7)
    expect(pagina.contrarreembolsos).toEqual([{ id: 'c1', importe: 1500.5 }, { id: 'c2', importe: 20 }])
  })

  it('conserva un estado válido, devuelve total 0 sin filas y propaga errores', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await expect(listarContrarreembolsos({ empresaId: 'e1', estado: 'pendiente', pagina: 2, tamano: 5 })).resolves.toEqual({ contrarreembolsos: [], total: 0 })
    expect(mocks.rpc).toHaveBeenCalledWith('listar_contrarreembolsos', { p_empresa_id: 'e1', p_estado: 'pendiente', p_pagina: 2, p_tamano: 5 })
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
    await expect(listarContrarreembolsos({ empresaId: null, estado: null, pagina: 1, tamano: 5 })).rejects.toMatchObject({ code: '42501' })
  })
})

describe('resumenContrarreembolsos', () => {
  it('convierte a número y usa 0 donde falta el dato', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ pendiente_importe: '300.25', pendiente_cantidad: 2 }], error: null })
    await expect(resumenContrarreembolsos('e1')).resolves.toEqual({ pendiente_importe: 300.25, pendiente_cantidad: 2, cobrado_mes_importe: 0 })
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    await expect(resumenContrarreembolsos(null)).resolves.toEqual({ pendiente_importe: 0, pendiente_cantidad: 0, cobrado_mes_importe: 0 })
  })
})

describe('puedeCobrarContrarreembolso', () => {
  it('una empresa en blanco no consulta y solo un true estricto habilita', async () => {
    await expect(puedeCobrarContrarreembolso('  ')).resolves.toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
    mocks.rpc.mockResolvedValue({ data: true, error: null })
    await expect(puedeCobrarContrarreembolso('e1')).resolves.toBe(true)
    mocks.rpc.mockResolvedValue({ data: 'true', error: null })
    await expect(puedeCobrarContrarreembolso('e1')).resolves.toBe(false)
  })
})

describe('marcarContrarreembolsoCobrado', () => {
  it('exige id y versión leída antes de llamar a la base', async () => {
    await expect(marcarContrarreembolsoCobrado(' ', 'v1')).rejects.toThrow(/no tiene id/)
    await expect(marcarContrarreembolsoCobrado('c1', '')).rejects.toThrow(/versión/)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('manda la versión para el bloqueo optimista y convierte el importe', async () => {
    mocks.rpc.mockResolvedValue({ data: { id: 'c1', importe: '99.9', estado: 'cobrado' }, error: null })
    await expect(marcarContrarreembolsoCobrado('c1', 'v1')).resolves.toMatchObject({ importe: 99.9, estado: 'cobrado' })
    expect(mocks.rpc).toHaveBeenCalledWith('marcar_contrarreembolso_cobrado', { p_id: 'c1', p_actualizado_en: 'v1' })
  })

  it('no confirma un cobro si la base no devuelve la fila', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await expect(marcarContrarreembolsoCobrado('c1', 'v1')).rejects.toThrow(/no devolvió/)
  })
})
