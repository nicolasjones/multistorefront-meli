import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { notificacion, simularRpc as simular } from './pruebas-notificaciones'

const rpc = vi.hoisted(() => vi.fn())
const simularRpc = (o: Parameters<typeof simular>[1] = {}) => simular(rpc, o)

vi.mock('../../lib/supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/supabase')>()
  return { ...actual, supabaseClient: { ...actual.supabaseClient, rpc } }
})

import { CampanitaNotificaciones } from './CampanitaNotificaciones'

describe('Marcar notificaciones leídas (FR-008)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('abrir un aviso sin leer lo marca y baja el conteo', async () => {
    simularRpc({ sinLeer: 2, items: [notificacion(1), notificacion(2)] })
    render(<CampanitaNotificaciones />)
    fireEvent.click(await screen.findByRole('button', { name: 'Notificaciones, 2 sin leer' }))
    fireEvent.click(await screen.findByText('Nombre: Persona 1 · Producto: Remera'))
    expect(rpc).toHaveBeenCalledWith('marcar_notificaciones_leidas', { p_ids: ['n-1'] })
    await waitFor(() => expect(screen.getByRole('button', { name: /Notificaciones, 1 sin leer/, hidden: true })).toBeInTheDocument())
  })

  it('«Marcar todas como leídas» marca todo y se deshabilita sin pendientes', async () => {
    simularRpc({ sinLeer: 2, items: [notificacion(1), notificacion(2)] })
    render(<CampanitaNotificaciones />)
    fireEvent.click(await screen.findByRole('button', { name: 'Notificaciones, 2 sin leer' }))
    const todas = await screen.findByRole('button', { name: 'Marcar todas como leídas' })
    expect(todas).toBeEnabled()
    fireEvent.click(todas)
    expect(rpc).toHaveBeenCalledWith('marcar_notificaciones_leidas', { p_ids: null })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Marcar todas como leídas' })).toBeDisabled())
  })

  it('si marcar falla avisa y no baja los no leídos de la lista', async () => {
    simularRpc({ sinLeer: 1, items: [notificacion(1)] })
    rpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'marcar_notificaciones_leidas') return { data: null, error: { message: 'x' } }
      if (nombre === 'contar_notificaciones_sin_leer') return { data: 1, error: null }
      return { data: { total: 1, items: [notificacion(1)] }, error: null }
    })
    render(<CampanitaNotificaciones />)
    fireEvent.click(await screen.findByRole('button', { name: /Notificaciones/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar todas como leídas' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos marcar las notificaciones')
  })
})
