import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
const signInWithPassword = vi.hoisted(() => vi.fn())
const signOut = vi.hoisted(() => vi.fn())
const getSession = vi.hoisted(() => vi.fn())
const maybeSingle = vi.hoisted(() => vi.fn())
const setMantenerSesion = vi.hoisted(() => vi.fn())
const getMantenerSesion = vi.hoisted(() => vi.fn(() => false))

vi.mock('../lib/supabase', () => ({
  getMantenerSesion,
  setMantenerSesion,
  setIngresoEnCurso: vi.fn(),
  supabaseClient: {
    rpc,
    auth: { signInWithPassword, signOut, getSession },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  },
}))

import {
  authProvider,
  mensajeIngresoBloqueado,
  mensajeIngresoGenerico,
  mensajeIngresoTecnico,
} from './authProvider'
import { CLAVE_MANTENER_SESION, CLAVE_ULTIMA_ACTIVIDAD, INACTIVIDAD_MAXIMA_MS } from '../lib/vencimientoSesion'

const sesion = { user: { id: 'u1' } }

function rpcs(overrides: Record<string, unknown> = {}) {
  rpc.mockImplementation(async (nombre: string) => ({
    data: nombre in overrides ? overrides[nombre] : null,
    error: null,
  }))
}

describe('authProvider.login (F-ACC-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getMantenerSesion.mockReturnValue(false)
    window.localStorage.clear()
    rpcs()
    signOut.mockResolvedValue({ error: null })
    signInWithPassword.mockResolvedValue({ data: { session: sesion }, error: null })
    maybeSingle.mockResolvedValue({ data: { estado: 'activo' } })
  })

  it('ingresa con credenciales válidas, normaliza el correo y limpia los intentos', async () => {
    const resultado = await authProvider.login({ email: ' Persona@Example.com ', password: 'x', remember: true })

    expect(resultado).toEqual({ success: true, redirectTo: '/' })
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'persona@example.com', password: 'x' })
    expect(rpc).toHaveBeenCalledWith('limpiar_intentos_acceso')
    expect(setMantenerSesion).toHaveBeenCalledWith(true)
  })

  it('un superadmin sin fila en usuarios_organizacion ingresa (sin membresía no es rechazo)', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })

    const resultado = await authProvider.login({ email: 'super@example.com', password: 'x' })

    expect(resultado).toEqual({ success: true, redirectTo: '/' })
    expect(signOut).not.toHaveBeenCalled()
  })

  it('muestra el mismo mensaje genérico para cualquier fallo de credenciales y registra el intento', async () => {
    signInWithPassword.mockResolvedValue({ data: { session: null }, error: { message: 'Invalid login credentials', code: 'invalid_credentials', status: 400 } })

    const resultado = await authProvider.login({ email: 'no-existe@example.com', password: 'mal' })

    expect(resultado.success).toBe(false)
    expect(resultado.error?.message).toBe(mensajeIngresoGenerico)
    expect(rpc).toHaveBeenCalledWith('registrar_fallo_acceso', { p_correo: 'no-existe@example.com' })
  })

  it('avisa del bloqueo cuando el fallo alcanza el límite', async () => {
    rpcs({ registrar_fallo_acceso: '2026-10-12T10:15:00Z' })
    signInWithPassword.mockResolvedValue({ data: { session: null }, error: { message: 'Invalid', code: 'invalid_credentials', status: 400 } })

    const resultado = await authProvider.login({ email: 'a@example.com', password: 'mal' })

    expect(resultado.error?.message).toBe(mensajeIngresoBloqueado)
  })

  it('no contacta a Auth mientras el correo está bloqueado, aun con credenciales correctas', async () => {
    rpcs({ bloqueo_acceso_hasta: '2026-10-12T10:15:00Z' })

    const resultado = await authProvider.login({ email: 'a@example.com', password: 'bien' })

    expect(resultado.error?.message).toBe(mensajeIngresoBloqueado)
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('rechaza al suspendido con el mensaje genérico y cierra la sesión creada', async () => {
    maybeSingle.mockResolvedValue({ data: { estado: 'suspendido' } })

    const resultado = await authProvider.login({ email: 'a@example.com', password: 'bien' })

    expect(resultado.success).toBe(false)
    expect(resultado.error?.message).toBe(mensajeIngresoGenerico)
    expect(signOut).toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalledWith('limpiar_intentos_acceso')
  })

  it('si signOut falla al rechazar al suspendido, reintenta descartando la sesión local', async () => {
    maybeSingle.mockResolvedValue({ data: { estado: 'suspendido' } })
    signOut.mockResolvedValueOnce({ error: { message: 'network error' } })

    await authProvider.login({ email: 'a@example.com', password: 'bien' })

    expect(signOut).toHaveBeenNthCalledWith(2, { scope: 'local' })
  })

  it('el rechazo del suspendido restaura la marca previa de «Mantener la sesión»', async () => {
    window.localStorage.setItem('sesion:mantener', 'true')
    maybeSingle.mockResolvedValue({ data: { estado: 'suspendido' } })

    await authProvider.login({ email: 'a@example.com', password: 'bien', remember: false })

    expect(window.localStorage.getItem('sesion:mantener')).toBe('true')
  })

  it('falla cerrado si la consulta de membresía da error: cierra la sesión y rechaza', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'network error' } })

    const resultado = await authProvider.login({ email: 'a@example.com', password: 'bien' })

    expect(resultado.success).toBe(false)
    expect(resultado.error?.message).toBe(mensajeIngresoGenerico)
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(rpc).not.toHaveBeenCalledWith('limpiar_intentos_acceso')
  })

  it('sin «Mantener la sesión iniciada» pide sesión de pestaña', async () => {
    await authProvider.login({ email: 'a@example.com', password: 'bien' })

    expect(setMantenerSesion).toHaveBeenCalledWith(false)
  })

  it('si el Auth Hook rechaza durante el intento (código distinto de invalid_credentials) muestra el bloqueo y no cuenta un fallo', async () => {
    // Antes de contactar a Auth no estaba bloqueado; después de que el hook rechaza, sí.
    let consultas = 0
    rpc.mockImplementation(async (nombre: string) => ({
      data: nombre === 'bloqueo_acceso_hasta' && ++consultas > 1 ? '2026-10-12T10:15:00Z' : null,
      error: null,
    }))
    signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: 'Demasiados intentos.', code: 'hook_rejected', status: 400 },
    })

    const resultado = await authProvider.login({ email: 'a@example.com', password: 'bien' })

    expect(resultado.error?.message).toBe(mensajeIngresoBloqueado)
    expect(rpc).not.toHaveBeenCalledWith('registrar_fallo_acceso', expect.anything())
  })

  it('un error de Auth distinto de invalid_credentials sin bloqueo vigente conserva el mensaje genérico', async () => {
    signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: 'otro', code: 'validation_failed', status: 400 },
    })

    const resultado = await authProvider.login({ email: 'a@example.com', password: 'x' })

    expect(resultado.error?.message).toBe(mensajeIngresoGenerico)
  })

  it('falla cerrado si la consulta de bloqueo da error: rechaza sin contactar a Auth', async () => {
    rpc.mockImplementation(async (nombre: string) =>
      nombre === 'bloqueo_acceso_hasta'
        ? { data: null, error: { message: 'function not found' } }
        : { data: null, error: null },
    )

    const resultado = await authProvider.login({ email: 'a@example.com', password: 'bien' })

    expect(resultado.success).toBe(false)
    expect(resultado.error?.message).toBe(mensajeIngresoTecnico)
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it.each([
    ['5xx', 503, 'mensajeIngresoTecnico'],
    ['429', 429, 'mensajeIngresoTecnico'],
    ['400', 400, 'mensajeIngresoGenerico'],
  ])('si Auth responde %s y la consulta de bloqueo falla, no lanza ni muestra «bloqueado»', async (_, status, esperado) => {
    rpc.mockImplementation(async (nombre: string, ..._r: unknown[]) => {
      if (nombre === 'bloqueo_acceso_hasta') {
        return rpc.mock.calls.filter(([n]) => n === 'bloqueo_acceso_hasta').length > 1
          ? { data: null, error: { message: 'rpc caída' } }
          : { data: null, error: null }
      }
      return { data: null, error: null }
    })
    signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: 'otro', code: 'unexpected_failure', status },
    })

    const resultado = await authProvider.login({ email: 'a@example.com', password: 'x' })

    expect(resultado.success).toBe(false)
    expect(resultado.error?.message).toBe(
      esperado === 'mensajeIngresoTecnico' ? mensajeIngresoTecnico : mensajeIngresoGenerico,
    )
    expect(rpc).not.toHaveBeenCalledWith('registrar_fallo_acceso', expect.anything())
  })

  it('si signInWithPassword lanza una excepción restaura la marca previa', async () => {
    signInWithPassword.mockRejectedValue(new Error('boom'))

    await expect(
      authProvider.login({ email: 'a@example.com', password: 'x', remember: true }),
    ).rejects.toThrow('boom')

    expect(setMantenerSesion).toHaveBeenNthCalledWith(1, true)
    expect(setMantenerSesion).toHaveBeenLastCalledWith(false)
  })

  it('rechaza con el mensaje genérico si no se puede registrar el fallo', async () => {
    signInWithPassword.mockResolvedValue({ data: { session: null }, error: { message: 'Invalid', code: 'invalid_credentials', status: 400 } })
    rpc.mockImplementation(async (nombre: string) =>
      nombre === 'registrar_fallo_acceso'
        ? { data: null, error: { message: 'rpc error' } }
        : { data: null, error: null },
    )

    const resultado = await authProvider.login({ email: 'a@example.com', password: 'mal' })

    expect(resultado.success).toBe(false)
    expect(resultado.error?.message).toBe(mensajeIngresoGenerico)
  })

  it('no deja persistida la preferencia de mantener sesión si el ingreso falla', async () => {
    signInWithPassword.mockResolvedValue({ data: { session: null }, error: { message: 'Invalid', code: 'invalid_credentials', status: 400 } })

    await authProvider.login({ email: 'a@example.com', password: 'mal', remember: true })

    expect(setMantenerSesion).toHaveBeenNthCalledWith(1, true)
    expect(setMantenerSesion).toHaveBeenLastCalledWith(false)
  })

  it('al fallar restaura la preferencia previa en vez de forzar false', async () => {
    getMantenerSesion.mockReturnValue(true)
    signInWithPassword.mockResolvedValue({ data: { session: null }, error: { message: 'Invalid', code: 'invalid_credentials', status: 400 } })

    await authProvider.login({ email: 'a@example.com', password: 'mal' })

    expect(setMantenerSesion).toHaveBeenLastCalledWith(true)
  })

  it.each([
    ['red caída', { message: 'fetch failed', name: 'AuthRetryableFetchError', status: 0 }, mensajeIngresoTecnico],
    ['400 de otra causa (correo sin confirmar)', { message: 'Email not confirmed', code: 'email_not_confirmed', status: 400 }, mensajeIngresoGenerico],
    ['400 sin código', { message: 'Bad request', status: 400 }, mensajeIngresoGenerico],
    ['rate limit', { message: 'Too many requests', code: 'over_request_rate_limit', status: 429 }, mensajeIngresoTecnico],
    ['error 5xx de Auth', { message: 'Unavailable', status: 503 }, mensajeIngresoTecnico],
  ])('no cuenta como fallo de credenciales: %s', async (_nombre, error, mensaje) => {
    signInWithPassword.mockResolvedValue({ data: { session: null }, error })

    const resultado = await authProvider.login({ email: 'a@example.com', password: 'bien' })

    expect(resultado.success).toBe(false)
    expect(resultado.error?.message).toBe(mensaje)
    expect(rpc).not.toHaveBeenCalledWith('registrar_fallo_acceso', expect.anything())
  })
})

describe('authProvider: cierre y vencimiento de sesión', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
    signOut.mockResolvedValue({ error: null })
  })

  it('logout cierra la sesión y redirige al ingreso', async () => {
    const resultado = await authProvider.logout({})
    expect(signOut).toHaveBeenCalled()
    expect(resultado).toEqual({ success: true, redirectTo: '/login' })
  })

  it('logout descarta la sesión local si el cierre global falla', async () => {
    signOut.mockResolvedValueOnce({ error: { message: 'red' } })
    const resultado = await authProvider.logout({})
    expect(signOut).toHaveBeenLastCalledWith({ scope: 'local' })
    expect(resultado).toMatchObject({ success: false, redirectTo: '/login' })
  })

  it('check mantiene una sesión con actividad reciente', async () => {
    const resultado = await authProvider.check({})
    expect(resultado).toEqual({ authenticated: true })
  })

  it('check cierra la sesión tras 12 h de inactividad', async () => {
    localStorage.setItem(CLAVE_ULTIMA_ACTIVIDAD, String(Date.now() - INACTIVIDAD_MAXIMA_MS - 1000))
    const resultado = await authProvider.check({})
    expect(signOut).toHaveBeenCalled()
    expect(resultado).toMatchObject({ authenticated: false, redirectTo: '/login' })
  })

  it('check no cierra la sesión con «Mantener la sesión iniciada» aunque pasen más de 12 h', async () => {
    localStorage.setItem(CLAVE_MANTENER_SESION, 'true')
    localStorage.setItem(CLAVE_ULTIMA_ACTIVIDAD, String(Date.now() - INACTIVIDAD_MAXIMA_MS - 1000))
    const resultado = await authProvider.check({})
    expect(signOut).not.toHaveBeenCalled()
    expect(resultado).toEqual({ authenticated: true })
  })

  it('check sin sesión limpia el rastro de actividad', async () => {
    localStorage.setItem(CLAVE_ULTIMA_ACTIVIDAD, String(Date.now()))
    getSession.mockResolvedValue({ data: { session: null }, error: null })
    const resultado = await authProvider.check({})
    expect(localStorage.getItem(CLAVE_ULTIMA_ACTIVIDAD)).toBeNull()
    expect(resultado).toEqual({ authenticated: false, redirectTo: '/login' })
  })

  it('check con sesión pero sin marca de actividad no la cierra y arranca el reloj', async () => {
    const resultado = await authProvider.check({})
    expect(signOut).not.toHaveBeenCalled()
    expect(resultado).toEqual({ authenticated: true })
    expect(localStorage.getItem(CLAVE_ULTIMA_ACTIVIDAD)).not.toBeNull()
  })

  it('check vencido cierra solo la sesión local si el cierre global falla', async () => {
    localStorage.setItem(CLAVE_ULTIMA_ACTIVIDAD, String(Date.now() - INACTIVIDAD_MAXIMA_MS - 1000))
    signOut.mockResolvedValueOnce({ error: { message: 'red' } })
    const resultado = await authProvider.check({})
    expect(signOut).toHaveBeenLastCalledWith({ scope: 'local' })
    expect(localStorage.getItem(CLAVE_ULTIMA_ACTIVIDAD)).toBeNull()
    expect(resultado).toMatchObject({ authenticated: false, redirectTo: '/login', logout: true })
  })
})

describe('authProvider.logout (F-ACC-01, FR-005)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    signOut.mockResolvedValue({ error: null })
  })

  it('resetea la marca de «Mantener la sesión» al cerrar sesión', async () => {
    const resultado = await authProvider.logout({})

    expect(setMantenerSesion).toHaveBeenCalledWith(false)
    expect(resultado).toEqual({ success: true, redirectTo: '/login' })
  })

  it('conserva la marca si signOut falla (la sesión sigue en localStorage)', async () => {
    signOut.mockResolvedValue({ error: { message: 'red caída' } })

    const resultado = await authProvider.logout({})

    expect(setMantenerSesion).not.toHaveBeenCalled()
    expect(resultado).toMatchObject({ success: false })
  })
})
