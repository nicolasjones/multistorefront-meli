import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../test/axe'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChange: vi.fn(),
  consultarAcceso: vi.fn(),
  salirCliente: vi.fn(),
  llegoPorEnlace: vi.fn(),
  olvidarEnlace: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({
  supabaseClient: { auth: { getSession: mocks.getSession, updateUser: mocks.updateUser, signOut: mocks.signOut, onAuthStateChange: mocks.onAuthStateChange } },
}))
vi.mock('../../../lib/enlaceAuth', () => ({ llegoPorEnlace: mocks.llegoPorEnlace, olvidarEnlace: mocks.olvidarEnlace }))
vi.mock('../../../lib/tiendaCuenta', async (original) => ({
  ...(await original<typeof import('../../../lib/tiendaCuenta')>()),
  consultarAcceso: mocks.consultarAcceso,
  salirCliente: mocks.salirCliente,
}))

import { MENSAJE_INGRESO_GENERICO } from '../../../lib/tiendaCuenta'
import RutaDefinirContrasena from './definir-contrasena'

const contexto = { tienda: { tiendaId: 't-1', empresaNombre: 'Mundo JC', estado: 'publicada' }, host: 'mundojc.localhost', categorias: { fase: 'lista', categorias: [], reintentar: () => undefined } }
const VALIDA = 'Clave-Segura-123!'

function montar() {
  return render(
    <MemoryRouter initialEntries={['/definir-contrasena']}>
      <Routes>
        <Route element={<Outlet context={contexto} />}>
          <Route path="/definir-contrasena" element={<RutaDefinirContrasena />} />
          <Route path="/recuperar-contrasena" element={<p>Pantalla de recuperar</p>} />
          <Route path="/" element={<p>Inicio de la tienda</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

function completar(contrasena: string, confirmacion: string) {
  fireEvent.change(screen.getByLabelText(/^Nueva contraseña/), { target: { value: contrasena } })
  fireEvent.change(screen.getByLabelText(/^Confirmar contraseña/), { target: { value: confirmacion } })
  fireEvent.click(screen.getByRole('button', { name: 'Guardar y entrar' }))
}

describe('RutaDefinirContrasena (FR-022)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.llegoPorEnlace.mockReturnValue(true)
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'u' } } }, error: null })
    mocks.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
    mocks.updateUser.mockResolvedValue({ error: null })
    mocks.signOut.mockResolvedValue({ error: null })
    mocks.salirCliente.mockResolvedValue(undefined)
    mocks.consultarAcceso.mockResolvedValue({ estado: 'activa', tipo: 'minorista' })
  })

  it('con el enlace vigente guarda la contraseña, cierra otras sesiones y deja al cliente ingresado', async () => {
    montar()
    await screen.findByRole('heading', { name: 'Definir contraseña' })
    completar(VALIDA, VALIDA)
    expect(await screen.findByText('Inicio de la tienda')).toBeInTheDocument()
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: VALIDA })
    expect(mocks.olvidarEnlace).toHaveBeenCalled()
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'others' })
    expect(mocks.consultarAcceso).toHaveBeenCalledWith('mundojc.localhost')
    expect(mocks.salirCliente).not.toHaveBeenCalled()
  })

  it('una sesión abierta sin haber llegado por un enlace no permite cambiar la contraseña', async () => {
    mocks.llegoPorEnlace.mockReturnValue(false)
    montar()
    expect(await screen.findByText('El enlace venció o ya se usó. Pedí uno nuevo para continuar.')).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Nueva contraseña/)).not.toBeInTheDocument()
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })

  it('aplica la política de contraseñas: no guarda una contraseña débil ni una confirmación distinta', async () => {
    montar()
    await screen.findByRole('heading', { name: 'Definir contraseña' })
    completar('corta', 'corta')
    expect(await screen.findByRole('alert')).toHaveTextContent(/al menos 12 caracteres/i)
    completar(VALIDA, `${VALIDA}x`)
    expect(await screen.findByText('Las contraseñas no coinciden.')).toBeInTheDocument()
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })

  it('enlace vencido o usado (sin sesión): mensaje claro con salida a recuperar', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null })
    montar()
    expect(await screen.findByText('El enlace venció o ya se usó. Pedí uno nuevo para continuar.')).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Nueva contraseña/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Recuperar contraseña' })).toHaveAttribute('href', '/recuperar-contrasena')
  })

  it('si la cuenta no está activa en esta tienda no queda ingresado: signOut y mensaje genérico', async () => {
    mocks.consultarAcceso.mockResolvedValue({ estado: 'suspendida', tipo: null })
    montar()
    await screen.findByRole('heading', { name: 'Definir contraseña' })
    completar(VALIDA, VALIDA)
    expect(await screen.findByText(MENSAJE_INGRESO_GENERICO)).toBeInTheDocument()
    expect(mocks.salirCliente).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Inicio de la tienda')).not.toBeInTheDocument()
  })

  it('si no se puede guardar la contraseña lo avisa y no ingresa', async () => {
    mocks.updateUser.mockResolvedValue({ error: { message: 'x' } })
    montar()
    await screen.findByRole('heading', { name: 'Definir contraseña' })
    completar(VALIDA, VALIDA)
    expect(await screen.findByText('No pudimos guardar la contraseña. Intentá de nuevo.')).toBeInTheDocument()
    await waitFor(() => expect(mocks.consultarAcceso).not.toHaveBeenCalled())
  })

  it('no tiene violaciones de accesibilidad (formulario y enlace inválido)', async () => {
    const { container, unmount } = montar()
    await screen.findByRole('heading', { name: 'Definir contraseña' })
    expect(await violacionesAxe(container)).toEqual([])
    unmount()
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null })
    const invalido = montar()
    await screen.findByText(/El enlace venció/)
    expect(await violacionesAxe(invalido.container)).toEqual([])
  })
})
