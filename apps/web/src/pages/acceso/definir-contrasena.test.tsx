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

vi.mock('../../lib/supabase', () => ({
  supabaseClient: { auth },
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

    expect(await screen.findByRole('heading', { name: 'Crea tu contrasena' })).toBeInTheDocument()
    expect(auth.getSession).toHaveBeenCalled()
  })

  it('accepts a recovery-link session through the same protected form', async () => {
    window.location.hash = '#access_token=token&type=recovery'
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Define una contrasena nueva' })).toBeInTheDocument()
  })

  it('rejects an invalid password before calling Auth', async () => {
    window.location.hash = '#access_token=token&type=invite'
    renderPage()
    await screen.findByRole('heading', { name: 'Crea tu contrasena' })

    fireEvent.change(screen.getByLabelText(/^Nueva contrasena/), { target: { value: 'corta1!' } })
    fireEvent.change(screen.getByLabelText(/^Confirmar contrasena/), { target: { value: 'corta1!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contrasena' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/al menos 12 caracteres/i)
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it('keeps the current password when Auth rejects the update', async () => {
    window.location.hash = '#access_token=token&type=invite'
    auth.updateUser.mockResolvedValue({ error: new Error('network') })
    renderPage()
    await screen.findByRole('heading', { name: 'Crea tu contrasena' })

    fireEvent.change(screen.getByLabelText(/^Nueva contrasena/), { target: { value: 'ContrasenaSegura1!' } })
    fireEvent.change(screen.getByLabelText(/^Confirmar contrasena/), { target: { value: 'ContrasenaSegura1!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contrasena' }))

    expect(await screen.findByText(/La anterior sigue vigente/i)).toBeInTheDocument()
    expect(closeOtherSessions).not.toHaveBeenCalled()
  })
})
