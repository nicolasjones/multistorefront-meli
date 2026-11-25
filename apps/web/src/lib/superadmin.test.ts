import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
  from: vi.fn(),
  onAuthStateChange: vi.fn(),
}))

vi.mock('./supabase', () => ({
  supabaseClient: {
    auth: { getUser: mocks.getUser, onAuthStateChange: mocks.onAuthStateChange },
    from: mocks.from,
  },
}))

import { checkIsSuperadmin, invalidarCacheAcceso, obtenerUsuarioActual } from './superadmin'

describe('cache de acceso', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    invalidarCacheAcceso()
    mocks.from.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }),
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('comparte el usuario entre evaluaciones: una sola llamada a Auth', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    const resultados = await Promise.all([obtenerUsuarioActual(), obtenerUsuarioActual(), obtenerUsuarioActual()])
    expect(resultados).toEqual([{ id: 'u1' }, { id: 'u1' }, { id: 'u1' }])
    expect(mocks.getUser).toHaveBeenCalledTimes(1)
  })

  it('comparte la consulta de superadmin por usuario', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { user_id: 'u1' }, error: null })
    expect(await Promise.all([checkIsSuperadmin('u1'), checkIsSuperadmin('u1')])).toEqual([true, true])
    expect(mocks.maybeSingle).toHaveBeenCalledTimes(1)
  })

  it('otro usuario no hereda el resultado cacheado', async () => {
    mocks.maybeSingle.mockResolvedValueOnce({ data: { user_id: 'u1' }, error: null })
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null })
    expect(await checkIsSuperadmin('u1')).toBe(true)
    expect(await checkIsSuperadmin('u2')).toBe(false)
    expect(mocks.maybeSingle).toHaveBeenCalledTimes(2)
  })

  it('un error de la consulta deniega, deja traza y no se cachea', async () => {
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    expect(await checkIsSuperadmin('u1')).toBe(false)
    expect(console.error).toHaveBeenCalled()
    mocks.maybeSingle.mockResolvedValueOnce({ data: { user_id: 'u1' }, error: null })
    expect(await checkIsSuperadmin('u1')).toBe(true)
    expect(mocks.maybeSingle).toHaveBeenCalledTimes(2)
  })

  it('una excepción de red deniega y no se cachea', async () => {
    mocks.maybeSingle.mockRejectedValueOnce(new Error('red'))
    expect(await checkIsSuperadmin('u1')).toBe(false)
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null })
    expect(await checkIsSuperadmin('u1')).toBe(false)
    expect(mocks.maybeSingle).toHaveBeenCalledTimes(2)
  })

  it('un fallo de Auth (error o sin usuario) devuelve null y no se cachea', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'x' } })
    expect(await obtenerUsuarioActual()).toBeNull()
    mocks.getUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } }, error: null })
    expect(await obtenerUsuarioActual()).toEqual({ id: 'u1' })
    expect(mocks.getUser).toHaveBeenCalledTimes(2)
  })

  it('invalidarCacheAcceso (cambio de sesión) fuerza una consulta nueva', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null })
    await checkIsSuperadmin('u1')
    invalidarCacheAcceso()
    await checkIsSuperadmin('u1')
    expect(mocks.maybeSingle).toHaveBeenCalledTimes(2)
  })

  it('expira por TTL', async () => {
    vi.useFakeTimers()
    try {
      mocks.maybeSingle.mockResolvedValue({ data: null, error: null })
      await checkIsSuperadmin('u1')
      vi.advanceTimersByTime(6000)
      await checkIsSuperadmin('u1')
      expect(mocks.maybeSingle).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('un usuario con error a la vez se deniega', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } }, error: { message: 'x' } })
    expect(await obtenerUsuarioActual()).toBeNull()
  })

  describe('cableado de onAuthStateChange', () => {
    // El callback se registra una sola vez por carga del módulo: se captura tras el reset del beforeEach.
    async function callbackDeSesion(): Promise<() => void> {
      vi.resetModules()
      const modulo = await import('./superadmin')
      mocks.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
      await modulo.obtenerUsuarioActual()
      const llamada = mocks.onAuthStateChange.mock.calls.at(-1)
      expect(llamada).toBeDefined()
      return llamada![0] as () => void
    }

    it('el cambio de sesión descarta usuario y superadmin cacheados (logout de A, login de B)', async () => {
      vi.resetModules()
      const modulo = await import('./superadmin')
      mocks.getUser.mockResolvedValueOnce({ data: { user: { id: 'A' } }, error: null })
      mocks.maybeSingle.mockResolvedValueOnce({ data: { user_id: 'A' }, error: null })
      expect(await modulo.obtenerUsuarioActual()).toEqual({ id: 'A' })
      expect(await modulo.checkIsSuperadmin('A')).toBe(true)
      const alCambiarSesion = mocks.onAuthStateChange.mock.calls.at(-1)![0] as () => void

      alCambiarSesion()

      mocks.getUser.mockResolvedValueOnce({ data: { user: { id: 'B' } }, error: null })
      mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null })
      expect(await modulo.obtenerUsuarioActual()).toEqual({ id: 'B' })
      expect(await modulo.checkIsSuperadmin('A')).toBe(false)
      expect(mocks.getUser).toHaveBeenCalledTimes(2)
      expect(mocks.maybeSingle).toHaveBeenCalledTimes(2)
    })

    it('se registra una sola vez aunque haya muchas evaluaciones', async () => {
      await callbackDeSesion()
      expect(mocks.onAuthStateChange).toHaveBeenCalledTimes(1)
    })

    it('una consulta en vuelo no repuebla el cache tras invalidar', async () => {
      let resolver: (v: unknown) => void = () => undefined
      mocks.maybeSingle.mockReturnValueOnce(new Promise((r) => { resolver = r }))
      const enVuelo = checkIsSuperadmin('u1')
      invalidarCacheAcceso()
      resolver({ data: { user_id: 'u1' }, error: null })
      await enVuelo
      mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null })
      expect(await checkIsSuperadmin('u1')).toBe(false)
      expect(mocks.maybeSingle).toHaveBeenCalledTimes(2)
    })
  })
})
