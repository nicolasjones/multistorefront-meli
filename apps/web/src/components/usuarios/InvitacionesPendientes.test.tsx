import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
const order = vi.hoisted(() => vi.fn())
vi.mock('../../lib/supabase', () => ({
  supabaseClient: { functions: { invoke }, from: () => ({ select: () => ({ eq: () => ({ order }) }) }) },
}))

import { InvitacionesPendientes } from './InvitacionesPendientes'

const futura = new Date(Date.now() + 3 * 86_400_000).toISOString()
const pasada = new Date(Date.now() - 86_400_000).toISOString()

describe('InvitacionesPendientes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invoke.mockResolvedValue({ data: {}, error: null })
    order.mockResolvedValue({
      data: [
        { id: 'i1', email: 'a@example.com', rol_id: 'operador', estado: 'pendiente', vence_en: futura },
        { id: 'i2', email: 'b@example.com', rol_id: 'consulta', estado: 'pendiente', vence_en: pasada },
      ],
      error: null,
    })
  })

  it('no renderiza ni consulta nada para quien no gestiona usuarios', () => {
    const { container } = render(<InvitacionesPendientes puedeGestionar={false} />)

    expect(container).toBeEmptyDOMElement()
    expect(order).not.toHaveBeenCalled()
  })

  it('lista las invitaciones con estado pendiente o vencida', async () => {
    render(<InvitacionesPendientes puedeGestionar />)

    expect(await screen.findByText('a@example.com')).toBeInTheDocument()
    expect(screen.getAllByText('Invitación pendiente')).toHaveLength(1)
    expect(screen.getAllByText('Invitación vencida')).toHaveLength(1)
  })

  it('reenvía una invitación con su correo y rol', async () => {
    render(<InvitacionesPendientes puedeGestionar />)
    await screen.findByText('b@example.com')

    fireEvent.click(screen.getByRole('button', { name: 'Reenviar invitación a b@example.com' }))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('invitar-miembro', { body: { accion: 'invitar', email: 'b@example.com', rol: 'consulta' } }))
    expect(await screen.findByText(/^Invitación reenviada\. La invitación vence en 7 días; el enlace del correo dura 1 hora/)).toBeInTheDocument()
  })

  it('cancela una invitación por id tras confirmar sobre su correo', async () => {
    render(<InvitacionesPendientes puedeGestionar />)
    await screen.findByText('a@example.com')

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar invitación de a@example.com' }))
    expect(await screen.findByText(/¿Cancelar la invitación de a@example.com\?/)).toBeInTheDocument()
    expect(invoke).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar invitación' }))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('invitar-miembro', { body: { accion: 'cancelar', invitacion_id: 'i1' } }))
    expect(await screen.findByText('Invitación cancelada.')).toBeInTheDocument()
  })

  it('no cancela si la persona no confirma', async () => {
    render(<InvitacionesPendientes puedeGestionar />)
    await screen.findByText('a@example.com')

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar invitación de a@example.com' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Volver' }))

    expect(invoke).not.toHaveBeenCalled()
  })

  it('cada acción nombra el correo sobre el que actúa (FR-017)', async () => {
    render(<InvitacionesPendientes puedeGestionar />)
    await screen.findByText('a@example.com')

    for (const correo of ['a@example.com', 'b@example.com']) {
      expect(screen.getByRole('button', { name: `Reenviar invitación a ${correo}` })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: `Cancelar invitación de ${correo}` })).toBeInTheDocument()
    }
  })

  it('muestra el estado vacío y el de error con reintento', async () => {
    order.mockResolvedValueOnce({ data: [], error: null })
    const { unmount } = render(<InvitacionesPendientes puedeGestionar />)
    expect(await screen.findByText('No hay invitaciones pendientes.')).toBeInTheDocument()
    unmount()

    vi.spyOn(console, 'error').mockImplementation(() => {})
    order.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    render(<InvitacionesPendientes puedeGestionar />)
    expect(await screen.findByText('No se pudieron cargar las invitaciones. Intentá de nuevo.')).toBeInTheDocument()
    expect(screen.queryByText('boom')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })
})
