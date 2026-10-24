import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  getSession: vi.fn(),
  rpc: vi.fn(),
  rpcPublica: vi.fn(),
  schema: vi.fn(),
  invoke: vi.fn(),
}))

vi.mock('./supabase', () => ({
  supabaseClient: {
    auth: { signInWithPassword: mocks.signInWithPassword, signOut: mocks.signOut, getSession: mocks.getSession },
    schema: mocks.schema,
    rpc: mocks.rpcPublica,
    functions: { invoke: mocks.invoke },
  },
}))

import { mensajeIngresoBloqueado } from '../providers/authProvider'
import { ingresarCliente, MENSAJE_INGRESO_FALLA, MENSAJE_INGRESO_GENERICO, sesionActivaEnTienda, solicitarRecuperacionCliente } from './tiendaCuenta'

const HOST = 'mundojc.localhost'

describe('tiendaCuenta · ingresarCliente (FR-020, FR-021)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.schema.mockReturnValue({ rpc: mocks.rpc })
    mocks.signOut.mockResolvedValue({ error: null })
    mocks.signInWithPassword.mockResolvedValue({ error: null })
    mocks.rpcPublica.mockResolvedValue({ data: null, error: null })
  })

  it('con cuenta activa entra, consulta `acceso_cliente_por_dominio` del host y devuelve el tipo', async () => {
    mocks.rpc.mockResolvedValue({ data: { estado: 'activa', tipo: 'mayorista' }, error: null })
    const resultado = await ingresarCliente(HOST, ' Cli@Example.com ', 'Clave-12345!')
    expect(resultado).toEqual({ ok: true, tipo: 'mayorista' })
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: 'cli@example.com', password: 'Clave-12345!' })
    expect(mocks.schema).toHaveBeenCalledWith('publico')
    expect(mocks.rpc).toHaveBeenCalledWith('acceso_cliente_por_dominio', { host: HOST })
    expect(mocks.signOut).not.toHaveBeenCalled()
  })

  it('credenciales incorrectas: mensaje genérico y cierra cualquier sesión abierta', async () => {
    mocks.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials', code: 'invalid_credentials' } })
    const resultado = await ingresarCliente(HOST, 'cli@example.com', 'mala')
    expect(resultado).toEqual({ ok: false, mensaje: MENSAJE_INGRESO_GENERICO })
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.rpcPublica).toHaveBeenCalledWith('registrar_fallo_acceso', { p_correo: 'cli@example.com' })
  })

  it('FR-025: el bloqueo del template alcanza al correo del cliente (antes de Auth y al registrar el fallo)', async () => {
    mocks.rpcPublica.mockImplementation(async (nombre: string) => ({ data: nombre === 'bloqueo_acceso_hasta' ? '2026-10-24T12:00:00Z' : null, error: null }))
    expect(await ingresarCliente(HOST, 'cli@example.com', 'Clave-12345!')).toEqual({ ok: false, mensaje: mensajeIngresoBloqueado })
    expect(mocks.signInWithPassword).not.toHaveBeenCalled()

    mocks.rpcPublica.mockImplementation(async (nombre: string) => ({ data: nombre === 'registrar_fallo_acceso' ? true : null, error: null }))
    mocks.signInWithPassword.mockResolvedValue({ error: { message: 'x', code: 'invalid_credentials' } })
    expect(await ingresarCliente(HOST, 'cli@example.com', 'mala')).toEqual({ ok: false, mensaje: mensajeIngresoBloqueado })
  })

  it('FR-025: si no se puede consultar el bloqueo falla cerrado (no contacta a Auth)', async () => {
    mocks.rpcPublica.mockResolvedValue({ data: null, error: { message: 'red' } })
    expect(await ingresarCliente(HOST, 'cli@example.com', 'Clave-12345!')).toEqual({ ok: false, mensaje: MENSAJE_INGRESO_FALLA })
    expect(mocks.signInWithPassword).not.toHaveBeenCalled()
  })

  it('un error que no es de credenciales (red, 429) no cuenta como fallo', async () => {
    mocks.signInWithPassword.mockResolvedValue({ error: { message: 'x', code: 'over_request_rate_limit' } })
    await ingresarCliente(HOST, 'cli@example.com', 'Clave-12345!')
    expect(mocks.rpcPublica).not.toHaveBeenCalledWith('registrar_fallo_acceso', expect.anything())
  })

  it.each(['suspendida', 'sin_cuenta', 'no_habilitado'])('cuenta %s: el MISMO mensaje genérico y signOut', async (estado) => {
    mocks.rpc.mockResolvedValue({ data: { estado, tipo: null }, error: null })
    const resultado = await ingresarCliente(HOST, 'cli@example.com', 'Clave-12345!')
    expect(resultado).toEqual({ ok: false, mensaje: MENSAJE_INGRESO_GENERICO })
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
  })

  it('tienda desconocida (la base devuelve null): mensaje genérico y signOut', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    expect(await ingresarCliente(HOST, 'cli@example.com', 'Clave-12345!')).toEqual({ ok: false, mensaje: MENSAJE_INGRESO_GENERICO })
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
  })

  it('falla al consultar el acceso: no deja la sesión abierta y avisa que no se pudo verificar', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'red' } })
    expect(await ingresarCliente(HOST, 'cli@example.com', 'Clave-12345!')).toEqual({ ok: false, mensaje: MENSAJE_INGRESO_FALLA })
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
  })
})

describe('tiendaCuenta · sesionActivaEnTienda', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.schema.mockReturnValue({ rpc: mocks.rpc })
    mocks.signOut.mockResolvedValue({ error: null })
  })

  it('sin sesión devuelve null sin consultar la base', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null })
    expect(await sesionActivaEnTienda(HOST)).toBeNull()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('sesión con cuenta activa devuelve el acceso', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'u' } } }, error: null })
    mocks.rpc.mockResolvedValue({ data: { estado: 'activa', tipo: 'minorista' }, error: null })
    expect(await sesionActivaEnTienda(HOST)).toEqual({ estado: 'activa', tipo: 'minorista' })
    expect(mocks.signOut).not.toHaveBeenCalled()
  })

  it('sesión suspendida en esta tienda se cierra al instante', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'u' } } }, error: null })
    mocks.rpc.mockResolvedValue({ data: { estado: 'suspendida', tipo: null }, error: null })
    expect(await sesionActivaEnTienda(HOST)).toBeNull()
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
  })

  it('un error de red NO cierra la sesión: se propaga', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'u' } } }, error: null })
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'red' } })
    await expect(sesionActivaEnTienda(HOST)).rejects.toThrow('red')
    expect(mocks.signOut).not.toHaveBeenCalled()
  })
})

describe('tiendaCuenta · solicitarRecuperacionCliente (FR-023)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('invoca la Edge Function con el host y el correo normalizado', async () => {
    mocks.invoke.mockResolvedValue({ data: { ok: true }, error: null })
    expect(await solicitarRecuperacionCliente(HOST, ' Cli@Example.com ')).toBe(true)
    expect(mocks.invoke).toHaveBeenCalledWith('recuperar-clave-cliente', { body: { host: HOST, correo: 'cli@example.com' } })
  })

  it('una falla de la función devuelve false', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: { message: 'x' } })
    expect(await solicitarRecuperacionCliente(HOST, 'cli@example.com')).toBe(false)
  })
})
