import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { rpc: mocks.rpc, functions: { invoke: mocks.invoke } } }))

import {
  ErrorConfigurarDominio, ErrorVerificarDominio, configurarDominio, leerDominioTienda, normalizarDominio, textoUltimaVerificacion, validarDominios, verificarDominio,
} from './tiendaDominio'

describe('normalizarDominio', () => {
  it('recorta, pasa a minúsculas y quita puntos finales y puerto', () => {
    expect(normalizarDominio('  MiTienda.com.ar. ')).toBe('mitienda.com.ar')
    expect(normalizarDominio('mitienda.com.ar:8080')).toBe('mitienda.com.ar')
    expect(normalizarDominio('mitienda.com.ar.:')).toBe('mitienda.com.ar')
  })
})

describe('validarDominios', () => {
  it('acepta un dominio válido y una redirección opcional distinta', () => {
    expect(validarDominios('mitienda.com.ar', '')).toEqual({})
    expect(validarDominios('mitienda.com.ar', 'www.mitienda.com.ar')).toEqual({})
  })

  it('rechaza dominios sin TLD, con guiones en los bordes o vacíos', () => {
    expect(validarDominios('localhost', '').dominio).toBeDefined()
    expect(validarDominios('-mala.com', '').dominio).toBeDefined()
    expect(validarDominios('', '').dominio).toBeDefined()
  })

  it('rechaza una redirección inválida o igual al dominio principal', () => {
    expect(validarDominios('a.com', 'a.com').redireccion).toBeDefined()
    expect(validarDominios('a.com', 'A.COM.').redireccion).toBeDefined()
    expect(validarDominios('a.com', 'sin tld').redireccion).toBeDefined()
  })
})

describe('textoUltimaVerificacion', () => {
  const ahora = new Date('2026-11-17T12:00:00Z')
  it.each([
    [null, 'Nunca verificado'],
    ['2026-11-17T11:59:40Z', 'Última verificación hace un momento'],
    ['2026-11-17T11:15:00Z', 'Última verificación hace 45 min'],
    ['2026-11-17T06:00:00Z', 'Última verificación hace 6 h'],
    ['2026-11-14T12:00:00Z', 'Última verificación hace 3 d'],
    ['2026-11-18T12:00:00Z', 'Última verificación hace un momento'],
  ])('%s -> %s', (iso, esperado) => {
    expect(textoUltimaVerificacion(iso, ahora)).toBe(esperado)
  })
})

describe('llamadas a la base y a la función', () => {
  beforeEach(() => { mocks.rpc.mockReset(); mocks.invoke.mockReset() })

  it('leerDominioTienda pasa de snake_case a la forma de la pantalla', async () => {
    mocks.rpc.mockResolvedValue({ data: { dominio_vigente: 'a.com', dominio_pendiente: null, redireccion: null, dominio_verificado: true, certificado: 'activo', ultima_verificacion: null, registros: null }, error: null })
    await expect(leerDominioTienda('e1')).resolves.toEqual({
      dominioVigente: 'a.com', dominioPendiente: null, redireccion: null, dominioVerificado: true, certificado: 'activo', ultimaVerificacion: null, registros: [],
    })
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(leerDominioTienda('e1')).rejects.toThrow('boom')
  })

  it('configurarDominio manda null si la redirección está en blanco', async () => {
    mocks.rpc.mockResolvedValue({ error: null })
    await configurarDominio('e1', 'a.com', '   ')
    expect(mocks.rpc).toHaveBeenCalledWith('configurar_dominio_tienda', { p_empresa_id: 'e1', p_dominio: 'a.com', p_redireccion: null })
  })

  it('configurarDominio traduce los códigos conocidos a un error que nombra el campo', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'dominio_en_uso' } })
    const error = await configurarDominio('e1', 'a.com', '').catch((e) => e)
    expect(error).toBeInstanceOf(ErrorConfigurarDominio)
    expect(error.campo).toBe('dominio')
    mocks.rpc.mockResolvedValue({ error: { message: 'otra cosa' } })
    const generico = await configurarDominio('e1', 'a.com', '').catch((e) => e)
    expect(generico).not.toBeInstanceOf(ErrorConfigurarDominio)
    expect(generico.message).toBe('otra cosa')
  })

  it('verificarDominio devuelve el resultado y asume certificado pendiente si falta', async () => {
    mocks.invoke.mockResolvedValue({ data: { dominio_verificado: true, certificado: 'activo' }, error: null })
    await expect(verificarDominio('e1')).resolves.toEqual({ dominioVerificado: true, certificado: 'activo' })
    mocks.invoke.mockResolvedValue({ data: null, error: null })
    await expect(verificarDominio('e1')).resolves.toEqual({ dominioVerificado: false, certificado: 'pendiente' })
  })

  it('verificarDominio traduce el código de la función a un motivo y usa «otro» para lo desconocido', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: { context: { json: async () => ({ error: 'demasiado_pronto' }) } } })
    await expect(verificarDominio('e1')).rejects.toMatchObject({ motivo: 'demasiado_pronto' })
    mocks.invoke.mockResolvedValue({ data: null, error: { context: { json: async () => ({ error: 'raro' }) } } })
    await expect(verificarDominio('e1')).rejects.toBeInstanceOf(ErrorVerificarDominio)
    mocks.invoke.mockResolvedValue({ data: null, error: new Error('red') })
    await expect(verificarDominio('e1')).rejects.toMatchObject({ motivo: 'otro' })
  })
})
