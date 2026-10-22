import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), maybeSingle: vi.fn(), eq: vi.fn() }))

vi.mock('./supabase', () => ({
  supabaseClient: {
    schema: () => ({
      rpc: mocks.rpc,
      from: () => ({ select: () => ({ eq: (...args: unknown[]) => { mocks.eq(...args); return { maybeSingle: mocks.maybeSingle } } }) }),
    }),
  },
}))

import { esHostDeTienda, hostsDelPanel, leerTiendaDeEmpresa, normalizarHost, resolverTienda, urlDeTienda } from './tienda'

describe('normalizarHost', () => {
  it.each([
    ['MundoJC.LocalHost:443.', 'mundojc.localhost'],
    ['  ejemplo.com  ', 'ejemplo.com'],
    ['ejemplo.com..', 'ejemplo.com'],
    ['ejemplo.com.:443', 'ejemplo.com'],
    ['', ''],
  ])('normaliza %s', (entrada, esperado) => {
    expect(normalizarHost(entrada)).toBe(esperado)
  })
})

describe('hostsDelPanel / esHostDeTienda', () => {
  it('por defecto el panel vive en localhost y 127.0.0.1', () => {
    expect([...hostsDelPanel(undefined)]).toEqual(['localhost', '127.0.0.1'])
  })

  it('respeta la lista configurada', () => {
    expect([...hostsDelPanel('Panel.Ejemplo.com, admin.ejemplo.com')]).toEqual(['panel.ejemplo.com', 'admin.ejemplo.com'])
  })

  it('en producción sin VITE_PANEL_HOSTS falla seguro: ningún host es de tienda', () => {
    const panel = hostsDelPanel(undefined, true)
    expect(panel.size).toBe(0)
    expect(esHostDeTienda('tienda.ejemplo.com', panel)).toBe(false)
  })

  it.each([
    ['localhost', false],
    ['localhost:4300', false],
    ['mundojc.localhost', true],
    ['tienda.ejemplo.com', true],
    ['', false],
  ])('esHostDeTienda(%s) = %s', (host, esperado) => {
    expect(esHostDeTienda(host, new Set(['localhost', '127.0.0.1']))).toBe(esperado)
  })
})

describe('urlDeTienda', () => {
  it('conserva protocolo y puerto del panel', () => {
    expect(urlDeTienda('mundojc.com.ar', { protocol: 'http:', port: '4300' } as Location)).toBe('http://mundojc.com.ar:4300/')
    expect(urlDeTienda('mundojc.com.ar', { protocol: 'https:', port: '' } as Location)).toBe('https://mundojc.com.ar/')
  })
})

describe('resolverTienda', () => {
  beforeEach(() => vi.clearAllMocks())

  it('mapea la fila pública de la tienda', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ tienda_id: 't-1', empresa_nombre: 'Mundo JC', estado: 'publicada' }], error: null })
    await expect(resolverTienda('mundojc.localhost')).resolves.toEqual({ tiendaId: 't-1', empresaNombre: 'Mundo JC', estado: 'publicada' })
    expect(mocks.rpc).toHaveBeenCalledWith('tienda_por_dominio', { host: 'mundojc.localhost' })
  })

  it('devuelve null cuando el dominio no resuelve (desconocido o desactivado)', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    await expect(resolverTienda('no-existe.test')).resolves.toBeNull()
  })

  it('propaga el error de la consulta', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(resolverTienda('x.test')).rejects.toThrow('boom')
  })
})

describe('leerTiendaDeEmpresa', () => {
  beforeEach(() => vi.clearAllMocks())

  it('devuelve la tienda de la empresa', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { id: 't-1', dominio: 'mundojc.com.ar' }, error: null })
    await expect(leerTiendaDeEmpresa('e-1')).resolves.toEqual({ id: 't-1', dominio: 'mundojc.com.ar' })
    expect(mocks.eq).toHaveBeenCalledWith('empresa_id', 'e-1')
  })

  it('devuelve null si la empresa todavía no tiene dominio', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null })
    await expect(leerTiendaDeEmpresa('e-1')).resolves.toBeNull()
  })
})
