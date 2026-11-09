import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { schema: () => ({ rpc: mocks.rpc }) } }))

import { limpiarCacheSeo, recortar, seoDeTienda, TTL_CACHE_SEO_MS } from './tiendaSeo'

describe('recortar (F-TDA-21, FR-021)', () => {
  it('junta los espacios y no pasa el máximo, con «…» al cortar', () => {
    expect(recortar('  hola    mundo  ', 50)).toBe('hola mundo')
    const r = recortar('a'.repeat(200), 160)
    expect(r.length).toBe(160)
    expect(r.endsWith('…')).toBe(true)
  })

  it('tolera un texto ausente: devuelve cadena vacía en vez de romper la cabecera de SEO', () => {
    expect(recortar(undefined, 160)).toBe('')
    expect(recortar(null, 160)).toBe('')
  })
})

describe('recortar · caracteres fuera del plano básico (MSF-149)', () => {
  it('no parte un emoji ni un par sustituto al cortar', () => {
    const r = recortar('😀'.repeat(100), 10)
    expect(Array.from(r)).toHaveLength(10)
    expect(r).toBe(`${'😀'.repeat(9)}…`)
    expect(r).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/)
  })

  it('un texto corto con emoji queda igual', () => {
    expect(recortar('Hola 😀', 6)).toBe('Hola 😀')
  })
})

describe('seoDeTienda · caché con vencimiento (MSF-149)', () => {
  const fila = { dominio: 'a.test', nombre: 'A', descripcion: 'd', logo_ruta: null, indexable: true }

  beforeEach(() => {
    vi.useFakeTimers()
    limpiarCacheSeo()
    mocks.rpc.mockReset()
    mocks.rpc.mockResolvedValue({ data: fila, error: null })
  })
  afterEach(() => vi.useRealTimers())

  it('reusa la lectura dentro del TTL y vuelve a leer al vencer', async () => {
    await seoDeTienda('a.test')
    await seoDeTienda('a.test')
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(TTL_CACHE_SEO_MS - 1000)
    await seoDeTienda('a.test')
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(2000)
    await seoDeTienda('a.test')
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
  })

  it('un fallo no se guarda: la próxima llamada reintenta', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    await expect(seoDeTienda('a.test')).rejects.toThrow('boom')
    await seoDeTienda('a.test')
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
  })
})
