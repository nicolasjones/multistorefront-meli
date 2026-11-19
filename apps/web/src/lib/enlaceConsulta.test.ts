import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { mensajeDeErrorEnlace, obtenerEnlaceConsulta, regenerarEnlaceConsulta, urlEnlaceSeguimiento } from './enlaceConsulta'

beforeEach(() => mocks.rpc.mockReset())

describe('urlEnlaceSeguimiento', () => {
  it('quita las barras finales del origen y codifica el token', () => {
    expect(urlEnlaceSeguimiento('https://app.test///', 'a b/c')).toBe('https://app.test/seguimiento/a%20b%2Fc')
  })
})

describe('mensajeDeErrorEnlace', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => vi.restoreAllMocks())

  it('traduce permiso, límite de regeneraciones y reparación inexistente', () => {
    expect(mensajeDeErrorEnlace({ code: '42501' }, 'x')).toMatch(/No tenés permiso/)
    expect(mensajeDeErrorEnlace({ message: 'DEMASIADAS_REGENERACIONES: 5' }, 'x')).toMatch(/demasiadas veces/)
    expect(mensajeDeErrorEnlace({ code: 'P0002' }, 'x')).toMatch(/ya no existe/)
  })

  it('cualquier otro error devuelve el mensaje por defecto', () => {
    expect(mensajeDeErrorEnlace(new Error('red'), 'No pudimos')).toBe('No pudimos')
    expect(mensajeDeErrorEnlace(null, 'No pudimos')).toBe('No pudimos')
  })
})

describe.each([
  ['obtenerEnlaceConsulta', obtenerEnlaceConsulta, 'obtener_enlace_consulta'],
  ['regenerarEnlaceConsulta', regenerarEnlaceConsulta, 'regenerar_enlace_consulta'],
])('%s', (_nombre, funcion, rpc) => {
  it('devuelve el token de la respuesta y llama a la RPC con la reparación', async () => {
    mocks.rpc.mockResolvedValue({ data: { token: 'tok' }, error: null })
    await expect(funcion('r-1')).resolves.toBe('tok')
    expect(mocks.rpc).toHaveBeenCalledWith(rpc, { p_reparacion: 'r-1' })
  })

  it('rechaza una respuesta sin token o con token vacío', async () => {
    mocks.rpc.mockResolvedValue({ data: { token: '' }, error: null })
    await expect(funcion('r-1')).rejects.toThrow(/no trae el token/)
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await expect(funcion('r-1')).rejects.toThrow(/no trae el token/)
  })

  it('propaga el error de la base', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
    await expect(funcion('r-1')).rejects.toMatchObject({ code: '42501' })
  })
})
