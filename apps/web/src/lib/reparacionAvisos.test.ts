import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), maybeSingle: vi.fn() }))
vi.mock('./supabase', () => {
  const q: Record<string, unknown> = {}
  q.schema = () => q
  q.from = () => q
  q.select = () => q
  q.eq = () => q
  q.maybeSingle = mocks.maybeSingle
  return { supabaseClient: { rpc: mocks.rpc, schema: q.schema } }
})

import {
  MENSAJE_AVISOS_SIN_CONEXION, MENSAJE_ERROR_AVISAR, MENSAJE_ERROR_AVISAR_WHATSAPP, MENSAJE_ERROR_CARGAR_AVISOS, MENSAJE_SIN_PERMISO_AVISAR,
  avisarClienteDeReparacion, avisarClientePorWhatsapp, clienteTieneCorreo, listarAvisosDeReparacion, mensajeDeAvisar, mensajeDeAvisarWhatsapp, mensajeDeCargarAvisos,
} from './reparacionAvisos'

describe('mensajeDeAvisar y mensajeDeAvisarWhatsapp', () => {
  it.each([
    [mensajeDeAvisar, MENSAJE_ERROR_AVISAR],
    [mensajeDeAvisarWhatsapp, MENSAJE_ERROR_AVISAR_WHATSAPP],
  ])('traducen por código y usan su propio mensaje genérico', (funcion, generico) => {
    expect(funcion({ code: '42501', message: 'permission denied for function x' })).toBe(MENSAJE_SIN_PERMISO_AVISAR)
    expect(funcion({ code: 'P0001', hint: 'sin_conexion' })).toBe(MENSAJE_AVISOS_SIN_CONEXION)
    expect(funcion({ code: '55000' })).toMatch(/anulada/)
    expect(funcion({ code: 'XX000', message: 'algo técnico' })).toBe(generico)
    expect(funcion(null)).toBe(generico)
  })

  it('muestran tal cual el mensaje de la RPC con prefijo conocido', () => {
    expect(mensajeDeAvisar({ code: '22023', message: 'El estado no existe en esta tienda.' })).toBe('El estado no existe en esta tienda.')
    expect(mensajeDeAvisarWhatsapp({ message: 'La reparación no existe.' })).toBe('La reparación no existe.')
  })
})

describe('mensajeDeCargarAvisos', () => {
  it('distingue inexistente, sin permiso y genérico', () => {
    expect(mensajeDeCargarAvisos({ code: 'P0002' })).toMatch(/no existe/)
    expect(mensajeDeCargarAvisos({ code: '42501' })).toMatch(/no puede ver/)
    expect(mensajeDeCargarAvisos(undefined)).toBe(MENSAJE_ERROR_CARGAR_AVISOS)
  })
})

describe('llamadas a la base', () => {
  beforeEach(() => { mocks.rpc.mockReset(); mocks.maybeSingle.mockReset() })

  it('el estado es opcional y viaja como null', async () => {
    mocks.rpc.mockResolvedValue({ data: { resultado: 'encolado', aviso_id: 'a1' }, error: null })
    await avisarClienteDeReparacion('r1')
    expect(mocks.rpc).toHaveBeenLastCalledWith('avisar_cliente_reparacion', { p_reparacion: 'r1', p_estado_id: null })
    await avisarClientePorWhatsapp('r1', 'est1')
    expect(mocks.rpc).toHaveBeenLastCalledWith('avisar_cliente_whatsapp', { p_reparacion: 'r1', p_estado_id: 'est1' })
  })

  it('propagan el error de la base y el historial vacío es una lista', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
    await expect(avisarClienteDeReparacion('r1')).rejects.toMatchObject({ code: '42501' })
    await expect(listarAvisosDeReparacion('r1')).rejects.toMatchObject({ code: '42501' })
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await expect(listarAvisosDeReparacion('r1')).resolves.toEqual([])
  })

  it('clienteTieneCorreo devuelve true/false si lee la ficha y null si no se puede saber', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { correo: 'a@b.com' }, error: null })
    await expect(clienteTieneCorreo('c1')).resolves.toBe(true)
    mocks.maybeSingle.mockResolvedValue({ data: { correo: '   ' }, error: null })
    await expect(clienteTieneCorreo('c1')).resolves.toBe(false)
    mocks.maybeSingle.mockResolvedValue({ data: { correo: null }, error: null })
    await expect(clienteTieneCorreo('c1')).resolves.toBe(false)
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null })
    await expect(clienteTieneCorreo('c1')).resolves.toBeNull()
    mocks.maybeSingle.mockRejectedValue(new Error('red'))
    await expect(clienteTieneCorreo('c1')).resolves.toBeNull()
  })
})
