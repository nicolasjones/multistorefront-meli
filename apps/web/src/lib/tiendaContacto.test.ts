import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpcPublico: vi.fn() }))

vi.mock('./supabase', () => ({
  supabaseClient: { schema: (nombre: string) => ({ rpc: nombre === 'publico' ? mocks.rpcPublico : vi.fn() }) },
}))

import { enviarConsultaContacto, leerContactoTienda, minutosDeEspera, nuevaClaveEnvio, traducirRespuestaEnvio } from './tiendaContacto'

const DATOS = { nombre: '  Ana ', contacto: ' ana@ejemplo.com ', mensaje: ' Hola ' }
const CLAVE = '00000000-0000-4000-8000-0000000000a1'

// F-TDA-16 (FR-007): traducción de las respuestas de la base a estados de pantalla.
describe('leerContactoTienda', () => {
  beforeEach(() => vi.clearAllMocks())

  it('llama a publico.contacto_por_dominio y devuelve solo la lista blanca', async () => {
    mocks.rpcPublico.mockResolvedValue({ data: { nombre: 'Mundo JC', whatsapp: '+54 9 11 1', correo: null, horarios: 'L a V', extra: 'x' }, error: null })
    expect(await leerContactoTienda('mundojc.localhost')).toEqual({ nombre: 'Mundo JC', whatsapp: '+54 9 11 1', correo: null, horarios: 'L a V' })
    expect(mocks.rpcPublico).toHaveBeenCalledWith('contacto_por_dominio', { host: 'mundojc.localhost' })
  })

  it('null (host desconocido o empresa desactivada) → null', async () => {
    mocks.rpcPublico.mockResolvedValue({ data: null, error: null })
    expect(await leerContactoTienda('x')).toBeNull()
  })

  it('un error de la base se propaga', async () => {
    mocks.rpcPublico.mockResolvedValue({ data: null, error: { message: 'caído' } })
    await expect(leerContactoTienda('x')).rejects.toThrow('caído')
  })
})

describe('traducirRespuestaEnvio', () => {
  it.each([
    [{ estado: 'ok' }, { estado: 'exito' }],
    [{ estado: 'invalido', campos: ['mensaje', 'nombre', 'inventado'] }, { estado: 'invalido', campos: ['nombre', 'mensaje'] }],
    [{ estado: 'limite', espera_segundos: 125 }, { estado: 'espera', esperaSegundos: 125 }],
    [{ estado: 'limite' }, { estado: 'espera', esperaSegundos: 60 }],
    [{ estado: 'error' }, { estado: 'falla' }],
    [{ estado: 'raro' }, { estado: 'falla' }],
    [null, { estado: 'falla' }],
  ])('%j → %j', (respuesta, esperado) => {
    expect(traducirRespuestaEnvio(respuesta)).toEqual(esperado)
  })
})

describe('enviarConsultaContacto', () => {
  beforeEach(() => vi.clearAllMocks())

  it('envía los textos recortados con la clave del intento', async () => {
    mocks.rpcPublico.mockResolvedValue({ data: { estado: 'ok' }, error: null })
    expect(await enviarConsultaContacto('mundojc.localhost', DATOS, CLAVE)).toEqual({ estado: 'exito' })
    expect(mocks.rpcPublico).toHaveBeenCalledWith('enviar_consulta_contacto', {
      host: 'mundojc.localhost', nombre: 'Ana', contacto: 'ana@ejemplo.com', mensaje: 'Hola', clave_envio: CLAVE,
    })
  })

  it('un error del servidor o un corte de red es `falla`, sin detalle técnico', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.rpcPublico.mockResolvedValueOnce({ data: null, error: { message: 'detalle interno' } })
    expect(await enviarConsultaContacto('h', DATOS, CLAVE)).toEqual({ estado: 'falla' })
    mocks.rpcPublico.mockRejectedValueOnce(new Error('sin red'))
    expect(await enviarConsultaContacto('h', DATOS, CLAVE)).toEqual({ estado: 'falla' })
    consola.mockRestore()
  })
})

describe('claves y espera', () => {
  it('cada intento tiene su propia clave', () => {
    expect(nuevaClaveEnvio()).not.toBe(nuevaClaveEnvio())
    expect(nuevaClaveEnvio()).toMatch(/^[0-9a-f-]{36}$/)
  })

  it.each([[1, 1], [60, 1], [61, 2], [125, 3], [3600, 60]])('%i s → %i min', (segundos, minutos) => {
    expect(minutosDeEspera(segundos)).toBe(minutos)
  })
})
