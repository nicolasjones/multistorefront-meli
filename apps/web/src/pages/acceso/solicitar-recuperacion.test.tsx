import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const resetPasswordForEmail = vi.hoisted(() => vi.fn())
const passwordDefinitionRedirectUrl = vi.hoisted(() => vi.fn())

vi.mock('../../lib/supabase', () => ({
  supabaseClient: { auth: { resetPasswordForEmail } },
  passwordDefinitionRedirectUrl,
}))

import { SolicitarRecuperacionPage } from './solicitar-recuperacion'

const neutralNotice = 'Si existe una cuenta para ese correo, enviamos un enlace para continuar.'
const safeRedirect = 'http://localhost/acceso/definir-contrasena?origen=recuperacion'

describe('SolicitarRecuperacionPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetPasswordForEmail.mockResolvedValue({ error: null })
    passwordDefinitionRedirectUrl.mockReturnValue(safeRedirect)
  })

  async function requestFor(email: string) {
    render(<SolicitarRecuperacionPage />)
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: email } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace de recuperacion' }))
    await screen.findByText(neutralNotice)
  }

  it('keeps the public response neutral and sends existing accounts to the safe recovery route', async () => {
    await requestFor('persona@example.com')

    expect(resetPasswordForEmail).toHaveBeenCalledWith('persona@example.com', { redirectTo: safeRedirect })
    expect(passwordDefinitionRedirectUrl).toHaveBeenCalledWith('recuperacion', window.location.origin)
  })

  it('shows the same neutral response for an address that does not belong to an account', async () => {
    await requestFor('no-existe@example.com')

    expect(screen.getByText(neutralNotice)).toBeInTheDocument()
    expect(resetPasswordForEmail).toHaveBeenCalledWith('no-existe@example.com', expect.anything())
  })

  it('does not reveal account existence when the request is limited or fails', async () => {
    resetPasswordForEmail.mockResolvedValue({ error: new Error('rate limit') })
    render(<SolicitarRecuperacionPage />)
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'persona@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace de recuperacion' }))

    expect(await screen.findByText('No pudimos enviar el enlace ahora. Intenta nuevamente mas tarde.')).toBeInTheDocument()
    expect(screen.queryByText(neutralNotice)).not.toBeInTheDocument()
    expect(screen.queryByText(/no existe|cuenta registrada/i)).not.toBeInTheDocument()
  })
})
