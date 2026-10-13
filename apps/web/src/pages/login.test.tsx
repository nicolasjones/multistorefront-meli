import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mutateAsync = vi.hoisted(() => vi.fn())
const estado = vi.hoisted(() => ({ isPending: false }))

vi.mock('@refinedev/core', () => ({
  useLogin: () => ({ mutateAsync, isPending: estado.isPending }),
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
    estado.isPending = false
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

  it('un ingreso fallido no pinta un Alert propio: el único aviso es el toast de Refine', async () => {
    mutateAsync.mockResolvedValue({ success: false, error: { name: 'x', message: 'Revisá el correo y la contraseña e intentá de nuevo.' } })
    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/Revisá el correo/)).not.toBeInTheDocument()
  })

  it('ofrece el enlace de recuperación', () => {
    renderLogin()

    expect(screen.getByRole('link', { name: '¿Olvidaste tu contraseña?' })).toHaveAttribute('href', '/acceso/solicitar-recuperacion')
  })

  it('una excepción del ingreso no rompe la página ni pinta un Alert propio', async () => {
    mutateAsync.mockRejectedValue(new Error('network'))
    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('deshabilita el botón y muestra «Ingresando...» mientras se envía', () => {
    estado.isPending = true
    renderLogin()

    const boton = screen.getByRole('button', { name: 'Ingresando...' })
    expect(boton).toBeDisabled()
  })
})
