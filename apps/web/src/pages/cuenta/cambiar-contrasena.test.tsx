import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  updateUser: vi.fn(),
}))
const closeOtherSessions = vi.hoisted(() => vi.fn())
const verifyCurrentPassword = vi.hoisted(() => vi.fn())

vi.mock('../../lib/supabase', () => ({
  supabaseClient: { auth },
  closeOtherSessions,
  verifyCurrentPassword,
}))

import { CambiarContrasenaPage } from './cambiar-contrasena'

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/cuenta/cambiar-contrasena']}>
      <Routes>
        <Route path="/cuenta/cambiar-contrasena" element={<CambiarContrasenaPage />} />
        <Route path="/login" element={<p>Acceso requerido</p>} />
        <Route path="/" element={<p>Inicio</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

async function fillValidForm(currentPassword = 'ContrasenaActual1!') {
  fireEvent.change(await screen.findByLabelText(/^Contraseña actual/), { target: { value: currentPassword } })
  fireEvent.change(screen.getByLabelText(/^Nueva contraseña/), { target: { value: 'ContrasenaNueva1!' } })
  fireEvent.change(screen.getByLabelText(/^Confirmar contraseña/), { target: { value: 'ContrasenaNueva1!' } })
  fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }))
}

describe('CambiarContrasenaPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.getSession.mockResolvedValue({ data: { session: { access_token: 'token', user: { email: 'persona@example.com' } } }, error: null })
    auth.updateUser.mockResolvedValue({ error: null })
    closeOtherSessions.mockResolvedValue({ error: null })
    verifyCurrentPassword.mockResolvedValue({ error: null })
  })

  it('requires an authenticated session', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    renderPage()

    expect(await screen.findByText('Acceso requerido')).toBeInTheDocument()
  })

  it('validates the new password and confirmation before sending it to Auth', async () => {
    renderPage()
    await screen.findByLabelText(/^Contraseña actual/)
    fireEvent.change(screen.getByLabelText(/^Contraseña actual/), { target: { value: 'ContrasenaActual1!' } })
    fireEvent.change(screen.getByLabelText(/^Nueva contraseña/), { target: { value: 'corta1!' } })
    fireEvent.change(screen.getByLabelText(/^Confirmar contraseña/), { target: { value: 'corta1!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/al menos 12 caracteres/i)
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it('reports an incorrect current password without changing credentials', async () => {
    verifyCurrentPassword.mockResolvedValue({ error: { code: 'invalid_credentials', message: 'Current password is incorrect' } })
    renderPage()
    await fillValidForm()

    expect(await screen.findByText(/contraseña actual no coincide/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Recuperar acceso' })).toHaveAttribute('href', '/acceso/solicitar-recuperacion')
    expect(auth.updateUser).not.toHaveBeenCalled()
    expect(closeOtherSessions).not.toHaveBeenCalled()
  })

  it('rejects an empty current password without calling Auth or changing credentials', async () => {
    renderPage()
    await fillValidForm('')

    expect(await screen.findByRole('alert')).toHaveTextContent(/contraseña actual/i)
    expect(verifyCurrentPassword).not.toHaveBeenCalled()
    expect(auth.updateUser).not.toHaveBeenCalled()
    expect(closeOtherSessions).not.toHaveBeenCalled()
  })

  it('keeps the previous password when Auth rejects the update for an incorrect current password', async () => {
    auth.updateUser.mockResolvedValue({ error: { code: 'invalid_credentials', message: 'Current password is incorrect' } })
    renderPage()
    await fillValidForm()

    expect(await screen.findByText(/contraseña actual no coincide/i)).toBeInTheDocument()
    expect(closeOtherSessions).not.toHaveBeenCalled()
  })

  it('reports a temporary verification failure without treating it as an incorrect password', async () => {
    verifyCurrentPassword.mockResolvedValue({ error: { code: 'over_request_rate_limit', message: 'temporary failure' } })
    renderPage()
    await fillValidForm()

    expect(await screen.findByText(/No pudimos verificar la contraseña actual/i)).toBeInTheDocument()
    expect(screen.queryByText(/no coincide/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Recuperar acceso' })).not.toBeInTheDocument()
    expect(auth.updateUser).not.toHaveBeenCalled()
    expect(closeOtherSessions).not.toHaveBeenCalled()
  })

  it('updates with the current password and closes other sessions only after success', async () => {
    renderPage()
    await fillValidForm()

    expect(await screen.findByText('Inicio')).toBeInTheDocument()

    expect(auth.updateUser).toHaveBeenCalledWith({
      current_password: 'ContrasenaActual1!',
      password: 'ContrasenaNueva1!',
    })
    expect(verifyCurrentPassword).toHaveBeenCalledWith('persona@example.com', 'ContrasenaActual1!')
    expect(closeOtherSessions).toHaveBeenCalledOnce()
  })
})
