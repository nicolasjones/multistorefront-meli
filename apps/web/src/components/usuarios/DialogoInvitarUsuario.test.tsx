import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('../../lib/supabase', () => ({ supabaseClient: { functions: { invoke } } }))

import { DialogoInvitarUsuario } from './DialogoInvitarUsuario'

const abrir = (props: Partial<Parameters<typeof DialogoInvitarUsuario>[0]> = {}) =>
  render(<MemoryRouter><DialogoInvitarUsuario abierto onCerrar={vi.fn()} {...props} /></MemoryRouter>)

describe('DialogoInvitarUsuario', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invoke.mockResolvedValue({ data: {}, error: null })
  })

  it('ofrece los seis roles con descripción y el enlace «Ver permisos de este rol →»', () => {
    abrir()

    expect(screen.getAllByRole('radio')).toHaveLength(6)
    for (const nombre of ['Administrador', 'Operador', 'Consulta', 'Mostrador', 'Depósito', 'Administración']) {
      expect(screen.getByRole('radio', { name: new RegExp(nombre) })).toBeInTheDocument()
    }
    expect(screen.getByText('Solo lectura.')).toBeInTheDocument()
    expect(screen.getAllByText('Ver permisos de este rol →')).toHaveLength(6)
    expect(screen.queryByRole('radio', { name: /^Miembro/ })).not.toBeInTheDocument()
  })

  it('envía correo y rol elegido a la Edge Function y confirma «Invitación enviada»', async () => {
    const onEnviada = vi.fn()
    abrir({ onEnviada })

    fireEvent.change(screen.getByLabelText(/Correo electrónico/), { target: { value: ' Nueva@Example.com ' } })
    fireEvent.click(screen.getByRole('radio', { name: /Mostrador/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Enviar invitación' }))

    expect(await screen.findByText('Invitación enviada')).toBeInTheDocument()
    expect(invoke).toHaveBeenCalledWith('invitar-miembro', { body: { accion: 'invitar', email: 'Nueva@Example.com', rol: 'mostrador' } })
    expect(onEnviada).toHaveBeenCalled()
  })

  it('muestra el error del servidor y deja reintentar', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('La persona ya pertenece a una organización') })
    abrir()

    fireEvent.change(screen.getByLabelText(/Correo electrónico/), { target: { value: 'otra@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar invitación' }))

    expect(await screen.findByText('La persona ya pertenece a una organización')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar invitación' })).toBeEnabled())
  })

  it('no permite enviar sin correo', () => {
    abrir()

    expect(screen.getByRole('button', { name: 'Enviar invitación' })).toBeDisabled()
  })
})
