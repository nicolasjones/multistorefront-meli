import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { panelFixtures } from '../../test/fixtures/panel'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), from: vi.fn() }))
vi.mock('../../hooks/useContextoPanel', () => ({ useContextoPanel: () => ({ contexto: panelFixtures.administrador, isLoading: false }) }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc, functions: { invoke: mocks.invoke }, from: mocks.from } }))

import { ChatIAPanel } from './ChatIAPanel'

const historial = (mensajes: unknown[]) => ({
  select: () => ({ eq: () => ({ order: async () => ({ data: mensajes, error: null }) }) }),
})

describe('ChatIAPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('si el envío falla devuelve el texto al campo y no deja un mensaje fantasma', async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null })
    mocks.invoke.mockResolvedValue({ data: null, error: new Error('red caída') })
    render(<ChatIAPanel />)
    const campo = await screen.findByPlaceholderText('Escribí tu pregunta...')
    fireEvent.change(campo, { target: { value: 'Ventas de hoy' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByPlaceholderText('Escribí tu pregunta...')).toHaveValue('Ventas de hoy'))
    expect(screen.queryByText('Ventas de hoy', { selector: 'p, div, span' })).toBeNull()
  })

  it('«Confirmar» se deshabilita mientras corre y no ejecuta la acción dos veces', async () => {
    mocks.rpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'tiene_feature_publica') return { data: true, error: null }
      return new Promise(() => undefined)
    })
    mocks.invoke.mockResolvedValue({ data: { conversacion_id: 'c-1' }, error: null })
    mocks.from.mockReturnValue(historial([{ id: 'm-1', origen: 'asistente', contenido: 'Propongo crear algo', estado: 'propuesta' }]))
    render(<ChatIAPanel />)
    fireEvent.change(await screen.findByPlaceholderText('Escribí tu pregunta...'), { target: { value: 'hacé algo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    const confirmar = await screen.findByRole('button', { name: 'Confirmar' })
    fireEvent.click(confirmar)
    fireEvent.click(confirmar)
    await waitFor(() => expect(confirmar).toBeDisabled())
    expect(mocks.rpc.mock.calls.filter(([nombre]) => nombre === 'ejecutar_accion_chat_ia')).toHaveLength(1)
  })
})
