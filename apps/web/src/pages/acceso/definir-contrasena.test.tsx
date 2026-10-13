import { fireEvent, render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  updateUser: vi.fn(),
  resetPasswordForEmail: vi.fn(),
}))
const closeOtherSessions = vi.hoisted(() => vi.fn())
const rpc = vi.hoisted(() => vi.fn())

vi.mock('../../lib/supabase', () => ({
  supabaseClient: { auth, rpc },
  closeOtherSessions,
  passwordDefinitionRedirectUrl: vi.fn(() => 'http://127.0.0.1:3100/acceso/definir-contrasena?origen=recuperacion'),
}))

import { DefinirContrasenaPage } from './definir-contrasena'

function renderPage() {
  return render(<BrowserRouter><DefinirContrasenaPage /></BrowserRouter>)
}

describe('DefinirContrasenaPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/acceso/definir-contrasena')
    auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
    auth.getSession.mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null })
    auth.updateUser.mockResolvedValue({ error: null })
    auth.resetPasswordForEmail.mockResolvedValue({ error: null })
    closeOtherSessions.mockResolvedValue({ error: null })
    rpc.mockImplementation(async (nombre: string) => (nombre === 'mi_invitacion'
      ? { data: [{ rol_id: 'deposito', vencida: false }], error: null }
      : { data: 'deposito', error: null }))
  })

  it('shows a self-service request when the access link is missing or invalid', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { name: 'El enlace ya no sirve' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'persona@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar otro enlace' }))

    expect(await screen.findByText('Si existe una cuenta para ese correo, enviamos un enlace para continuar.')).toBeInTheDocument()
    expect(auth.getSession).not.toHaveBeenCalled()
  })

  it('shows the invitation form only after a valid invitation-link session', async () => {
    window.location.hash = '#access_token=token&type=invite'
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Crea tu contraseña' })).toBeInTheDocument()
    expect(auth.getSession).toHaveBeenCalled()
  })

  it('accepts a recovery-link session through the same protected form', async () => {
    window.location.hash = '#access_token=token&type=recovery'
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Define una contraseña nueva' })).toBeInTheDocument()
  })

  it('rejects an invalid password before calling Auth', async () => {
    window.location.hash = '#access_token=token&type=invite'
    renderPage()
    await screen.findByRole('heading', { name: 'Crea tu contraseña' })

    fireEvent.change(screen.getByLabelText(/^Nueva contraseña/), { target: { value: 'corta1!' } })
    fireEvent.change(screen.getByLabelText(/^Confirmar contraseña/), { target: { value: 'corta1!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y entrar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/al menos 12 caracteres/i)
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it('keeps the current password when Auth rejects the update', async () => {
    window.location.hash = '#access_token=token&type=invite'
    auth.updateUser.mockResolvedValue({ error: new Error('network') })
    renderPage()
    await screen.findByRole('heading', { name: 'Crea tu contraseña' })

    fireEvent.change(screen.getByLabelText(/^Nueva contraseña/), { target: { value: 'ContrasenaSegura1!' } })
    fireEvent.change(screen.getByLabelText(/^Confirmar contraseña/), { target: { value: 'ContrasenaSegura1!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y entrar' }))

    expect(await screen.findByText(/Tu invitación ya quedó aceptada, pero no pudimos guardar la contraseña/i)).toBeInTheDocument()
    expect(closeOtherSessions).not.toHaveBeenCalled()
  })

  it('muestra «Fuiste invitado como <rol>» y acepta la invitación antes de guardar la contraseña', async () => {
    window.location.hash = '#access_token=token&type=invite'
    renderPage()

    expect(await screen.findByText(/Fuiste invitado como/)).toHaveTextContent('Fuiste invitado como Depósito.')
    fireEvent.change(screen.getByLabelText(/^Nueva contraseña/), { target: { value: 'ContrasenaSegura1!' } })
    fireEvent.change(screen.getByLabelText(/^Confirmar contraseña/), { target: { value: 'ContrasenaSegura1!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y entrar' }))

    await vi.waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({ password: 'ContrasenaSegura1!' }))
    expect(rpc).toHaveBeenCalledWith('aceptar_invitacion')
    expect(rpc.mock.invocationCallOrder.at(-1)).toBeLessThan(auth.updateUser.mock.invocationCallOrder[0])
  })

  it('avisa que las contraseñas no coinciden', async () => {
    window.location.hash = '#access_token=token&type=invite'
    renderPage()
    await screen.findByRole('heading', { name: 'Crea tu contraseña' })

    fireEvent.change(screen.getByLabelText(/^Nueva contraseña/), { target: { value: 'ContrasenaSegura1!' } })
    fireEvent.change(screen.getByLabelText(/^Confirmar contraseña/), { target: { value: 'OtraContrasena2@' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y entrar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Las contraseñas no coinciden.')
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it('no deja definir la contraseña de una invitación vencida', async () => {
    window.location.hash = '#access_token=token&type=invite'
    rpc.mockImplementation(async (nombre: string) => (nombre === 'mi_invitacion'
      ? { data: [{ rol_id: 'deposito', vencida: true }], error: null }
      : { data: null, error: null }))
    renderPage()

    expect(await screen.findByText(/La invitación venció/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar y entrar' })).toBeDisabled()
  })

  it('rechaza guardar si el servidor dice que la invitación venció entre tanto', async () => {
    window.location.hash = '#access_token=token&type=invite'
    rpc.mockImplementation(async (nombre: string) => (nombre === 'mi_invitacion'
      ? { data: [{ rol_id: 'consulta', vencida: false }], error: null }
      : { data: null, error: { code: 'P0001', message: 'La invitación venció' } }))
    renderPage()
    await screen.findByText(/Fuiste invitado como/)

    fireEvent.change(screen.getByLabelText(/^Nueva contraseña/), { target: { value: 'ContrasenaSegura1!' } })
    fireEvent.change(screen.getByLabelText(/^Confirmar contraseña/), { target: { value: 'ContrasenaSegura1!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y entrar' }))

    expect(await screen.findByText(/La invitación venció/)).toBeInTheDocument()
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it('no deja entrar sin membresía si la invitación fue cancelada (P0002)', async () => {
    window.location.hash = '#access_token=token&type=invite'
    rpc.mockImplementation(async (nombre: string) => (nombre === 'mi_invitacion'
      ? { data: [], error: null }
      : { data: null, error: { code: 'P0002', message: 'Invitación cancelada o inexistente' } }))
    renderPage()
    await screen.findByRole('heading', { name: 'Crea tu contraseña' })

    fireEvent.change(screen.getByLabelText(/^Nueva contraseña/), { target: { value: 'ContrasenaSegura1!' } })
    fireEvent.change(screen.getByLabelText(/^Confirmar contraseña/), { target: { value: 'ContrasenaSegura1!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y entrar' }))

    expect(await screen.findByText(/La invitación fue cancelada o ya no existe/)).toBeInTheDocument()
    expect(auth.updateUser).not.toHaveBeenCalled()
    expect(closeOtherSessions).not.toHaveBeenCalled()
  })

  it('el reintento tras fallar el guardado de la contraseña vuelve a aceptar y termina de entrar', async () => {
    window.location.hash = '#access_token=token&type=invite'
    auth.updateUser.mockResolvedValueOnce({ error: new Error('network') })
    renderPage()
    await screen.findByRole('heading', { name: 'Crea tu contraseña' })

    fireEvent.change(screen.getByLabelText(/^Nueva contraseña/), { target: { value: 'ContrasenaSegura1!' } })
    fireEvent.change(screen.getByLabelText(/^Confirmar contraseña/), { target: { value: 'ContrasenaSegura1!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y entrar' }))
    await screen.findByText(/Tu invitación ya quedó aceptada/)

    fireEvent.click(screen.getByRole('button', { name: 'Guardar y entrar' }))

    await vi.waitFor(() => expect(closeOtherSessions).toHaveBeenCalledTimes(1))
    // La RPC es idempotente: el segundo intento devuelve el rol sin error y sigue hasta guardar.
    expect(rpc.mock.calls.filter(([nombre]) => nombre === 'aceptar_invitacion')).toHaveLength(2)
    expect(auth.updateUser).toHaveBeenCalledTimes(2)
  })

  it('con el enlace de recuperación («Solicitar otro enlace») también acepta la invitación pendiente antes de guardar', async () => {
    window.location.hash = '#access_token=token&type=recovery'
    renderPage()
    await screen.findByRole('heading', { name: 'Define una contraseña nueva' })

    fireEvent.change(screen.getByLabelText(/^Nueva contraseña/), { target: { value: 'ContrasenaSegura1!' } })
    fireEvent.change(screen.getByLabelText(/^Confirmar contraseña/), { target: { value: 'ContrasenaSegura1!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }))

    await vi.waitFor(() => expect(closeOtherSessions).toHaveBeenCalledTimes(1))
    expect(rpc).toHaveBeenCalledWith('aceptar_invitacion')
    expect(rpc.mock.invocationCallOrder.at(-1)).toBeLessThan(auth.updateUser.mock.invocationCallOrder[0])
  })

  it('una recuperación común (sin invitación pendiente, P0002) cambia la contraseña sin bloquearse', async () => {
    window.location.hash = '#access_token=token&type=recovery'
    rpc.mockImplementation(async () => ({ data: null, error: { code: 'P0002', message: 'Invitación cancelada o inexistente' } }))
    renderPage()
    await screen.findByRole('heading', { name: 'Define una contraseña nueva' })

    fireEvent.change(screen.getByLabelText(/^Nueva contraseña/), { target: { value: 'ContrasenaSegura1!' } })
    fireEvent.change(screen.getByLabelText(/^Confirmar contraseña/), { target: { value: 'ContrasenaSegura1!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }))

    await vi.waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({ password: 'ContrasenaSegura1!' }))
    expect(screen.queryByText(/invitación/i)).not.toBeInTheDocument()
  })

  it('si falla la consulta de la invitación (rechazo de red) muestra el formulario sin el rol y deja traza', async () => {
    window.location.hash = '#access_token=token&type=invite'
    const traza = vi.spyOn(console, 'error').mockImplementation(() => {})
    rpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'mi_invitacion') throw new Error('network')
      return { data: 'deposito', error: null }
    })
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Crea tu contraseña' })).toBeInTheDocument()
    await vi.waitFor(() => expect(traza).toHaveBeenCalled())
    expect(screen.queryByText(/Fuiste invitado como/)).not.toBeInTheDocument()
    traza.mockRestore()
  })
})
