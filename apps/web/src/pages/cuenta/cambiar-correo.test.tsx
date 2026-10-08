import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  updateUser: vi.fn(),
}))
const verifyCurrentPassword = vi.hoisted(() => vi.fn())
const profileRedirectUrl = vi.hoisted(() => vi.fn(() => 'http://127.0.0.1:3100/cuenta/perfil'))

vi.mock('../../lib/supabase', () => ({
  supabaseClient: { auth },
  profileRedirectUrl,
  verifyCurrentPassword,
}))

import { CambiarCorreoPage } from './cambiar-correo'

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/cuenta/cambiar-correo']}>
      <Routes>
        <Route path="/cuenta/cambiar-correo" element={<CambiarCorreoPage />} />
        <Route path="/login" element={<p>Acceso requerido</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('CambiarCorreoPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.getSession.mockResolvedValue({ data: { session: { user: { email: 'persona@example.com' } } }, error: null })
    auth.updateUser.mockResolvedValue({ error: null })
    verifyCurrentPassword.mockResolvedValue({ error: null })
  })

  it('requiere una sesion autenticada', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    renderPage()

    expect(await screen.findByText('Acceso requerido')).toBeInTheDocument()
  })

  it('requiere la contrasena actual antes de solicitar el cambio de correo', async () => {
    verifyCurrentPassword.mockResolvedValue({ error: { code: 'invalid_credentials' } })
    renderPage()
    fireEvent.change(await screen.findByLabelText(/^Contrasena actual para cambiar el correo/), { target: { value: 'incorrecta' } })
    fireEvent.change(screen.getByLabelText(/^Correo electronico nuevo/), { target: { value: 'nuevo@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar cambio de correo' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('La contrasena actual no coincide.')
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it('inicia la confirmacion en el correo nuevo despues de verificar la contrasena', async () => {
    renderPage()
    fireEvent.change(await screen.findByLabelText(/^Contrasena actual para cambiar el correo/), { target: { value: 'ContrasenaActual1!' } })
    fireEvent.change(screen.getByLabelText(/^Correo electronico nuevo/), { target: { value: 'nuevo@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar cambio de correo' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Enviamos una confirmacion a nuevo@example.com.')
    expect(verifyCurrentPassword).toHaveBeenCalledWith('persona@example.com', 'ContrasenaActual1!')
    expect(profileRedirectUrl).toHaveBeenCalledWith(window.location.origin)
    expect(auth.updateUser).toHaveBeenCalledWith(
      { email: 'nuevo@example.com' },
      { emailRedirectTo: 'http://127.0.0.1:3100/cuenta/perfil' },
    )
  })

  it('informa un correo ya asociado sin revelar datos de otra cuenta', async () => {
    auth.updateUser.mockResolvedValue({ error: { code: 'email_exists', message: 'User already registered' } })
    renderPage()
    fireEvent.change(await screen.findByLabelText(/^Contrasena actual para cambiar el correo/), { target: { value: 'ContrasenaActual1!' } })
    fireEvent.change(screen.getByLabelText(/^Correo electronico nuevo/), { target: { value: 'ocupado@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar cambio de correo' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No se puede usar ese correo electronico.')
    expect(screen.queryByText(/registered/i)).not.toBeInTheDocument()
  })

  it('informa una falla temporal de Auth sin iniciar una confirmacion', async () => {
    auth.updateUser.mockResolvedValue({ error: { code: 'over_request_rate_limit', message: 'temporary failure' } })
    renderPage()
    fireEvent.change(await screen.findByLabelText(/^Contrasena actual para cambiar el correo/), { target: { value: 'ContrasenaActual1!' } })
    fireEvent.change(screen.getByLabelText(/^Correo electronico nuevo/), { target: { value: 'nuevo@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar cambio de correo' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos solicitar el cambio de correo.')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
