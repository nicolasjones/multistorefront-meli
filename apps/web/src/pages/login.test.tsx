import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mutateAsync = vi.hoisted(() => vi.fn())

vi.mock('@refinedev/core', () => ({
  useLogin: () => ({ mutateAsync, isPending: false }),
}))

import { LoginPage } from './login'

function renderLogin() {
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  )
  fireEvent.change(screen.getByLabelText(/^Correo/), { target: { value: 'persona@example.com' } })
  fireEvent.change(screen.getByLabelText(/^Contraseña/), { target: { value: 'secreta' } })
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mutateAsync.mockResolvedValue({ success: true })
  })

  it('envía correo, contraseña y la opción de mantener la sesión', async () => {
    renderLogin()
    fireEvent.click(screen.getByLabelText('Mantener la sesión iniciada'))
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }))

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        email: 'persona@example.com',
        password: 'secreta',
        remember: true,
      }),
    )
  })

  it('muestra el mensaje que devuelve el ingreso fallido', async () => {
    mutateAsync.mockResolvedValue({ success: false, error: { name: 'x', message: 'Revisá el correo y la contraseña e intentá de nuevo.' } })
    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }))

    expect(await screen.findByText('Revisá el correo y la contraseña e intentá de nuevo.')).toBeInTheDocument()
  })

  it('ofrece el enlace de recuperación', () => {
    renderLogin()

    expect(screen.getByRole('link', { name: '¿La olvidaste?' })).toHaveAttribute('href', '/acceso/solicitar-recuperacion')
  })
})
