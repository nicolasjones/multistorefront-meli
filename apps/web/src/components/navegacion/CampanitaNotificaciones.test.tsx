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

describe('CampanitaNotificaciones (FR-006)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('anuncia la cantidad sin leer y muestra el punto solo si hay pendientes', async () => {
    simularRpc({ sinLeer: 3 })
    const { container } = render(<CampanitaNotificaciones />)
    expect(await screen.findByRole('button', { name: 'Notificaciones, 3 sin leer' })).toBeInTheDocument()
    expect(container.querySelector('.MuiBadge-invisible')).toBeNull()
  })

  it('sin pendientes el botón es «Notificaciones» y no hay punto', async () => {
    simularRpc({ sinLeer: 0 })
    const { container } = render(<CampanitaNotificaciones />)
    expect(await screen.findByRole('button', { name: 'Notificaciones' })).toBeInTheDocument()
    expect(container.querySelector('.MuiBadge-invisible')).not.toBeNull()
  })

  it('el desplegable muestra tipo, detalle legible y hora, sin identificadores técnicos (FR-007)', async () => {
    simularRpc({ sinLeer: 1, items: [notificacion(1, { datos: { Nombre: 'Ana', grupo: { x: 1 } } })] })
    render(<CampanitaNotificaciones />)
    fireEvent.click(await screen.findByRole('button', { name: /Notificaciones/ }))
    expect(await screen.findByText('Nombre: Ana')).toBeInTheDocument()
    expect(screen.getByText(/Consulta nueva/)).toBeInTheDocument()
    expect(screen.queryByText(/grupo|tipo_aviso/i)).toBeNull()
    expect(screen.getByText('1 notificación')).toBeInTheDocument()
  })

  it('sin avisos muestra el estado vacío compartido', async () => {
    simularRpc({ sinLeer: 0, items: [] })
    render(<CampanitaNotificaciones />)
    fireEvent.click(await screen.findByRole('button', { name: 'Notificaciones' }))
    expect(await screen.findByText('No tenés notificaciones.')).toBeInTheDocument()
  })

  it('si la consulta falla muestra el error con «Reintentar»', async () => {
    rpc.mockImplementation(async (nombre: string) =>
      nombre === 'listar_notificaciones' ? { data: null, error: { message: 'x' } } : { data: 0, error: null })
    render(<CampanitaNotificaciones />)
    fireEvent.click(await screen.findByRole('button', { name: 'Notificaciones' }))
    expect(await screen.findByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })

  it('«Cargar más» pide la tanda siguiente con el cursor y la suma a lo mostrado (FR-007)', async () => {
    const primera = Array.from({ length: 2 }, (_, i) => notificacion(i + 1))
    const segunda = [notificacion(3)]
    let llamadas = 0
    rpc.mockImplementation(async (nombre: string, args?: { p_antes_de: string | null }) => {
      if (nombre === 'contar_notificaciones_sin_leer') return { data: 3, error: null }
      llamadas += 1
      return { data: { total: 3, items: args?.p_antes_de ? segunda : primera }, error: null }
    })
    render(<CampanitaNotificaciones />)
    fireEvent.click(await screen.findByRole('button', { name: /Notificaciones/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cargar más' }))
    await waitFor(() => expect(screen.getAllByText(/Persona/)).toHaveLength(3))
    expect(rpc).toHaveBeenLastCalledWith('listar_notificaciones', { p_limite: 20, p_antes_de: primera[1].creado_en, p_antes_id: primera[1].id })
    expect(llamadas).toBe(2)
  })
})
