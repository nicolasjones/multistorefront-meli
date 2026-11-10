import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { notificacion } from './pruebas-notificaciones'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('../../lib/supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/supabase')>()
  return { ...actual, supabaseClient: { ...actual.supabaseClient, rpc } }
})

import { CampanitaNotificaciones } from './CampanitaNotificaciones'
import { useConteoSinLeer } from './useNotificaciones'

// Revisión retroactiva de MSF-378: una respuesta vieja del conteo no debe hacer reaparecer el punto rojo ni pisar una más
// nueva, y un doble clic sobre un aviso no lo descuenta dos veces.
function diferida<T>() {
  let resolver!: (valor: T) => void
  const promesa = new Promise<T>((r) => { resolver = r })
  return { promesa, resolver }
}

describe('Conteo de notificaciones: carreras', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('una respuesta vieja que llega DESPUÉS de marcar todas no hace reaparecer el conteo', async () => {
    const vieja = diferida<{ data: number; error: null }>()
    rpc.mockImplementation(() => vieja.promesa)
    const { result } = renderHook(() => useConteoSinLeer())
    // La persona marca todas como leídas mientras la consulta del montaje sigue en vuelo.
    act(() => { result.current.setConteo(0) })
    await act(async () => { vieja.resolver({ data: 3, error: null }) })
    expect(result.current.conteo).toBe(0)
  })

  it('dos refrescos: gana el más nuevo aunque el viejo responda último', async () => {
    const primera = diferida<{ data: number; error: null }>()
    const segunda = diferida<{ data: number; error: null }>()
    rpc.mockImplementationOnce(() => primera.promesa).mockImplementationOnce(() => segunda.promesa)
    const { result } = renderHook(() => useConteoSinLeer())
    act(() => { void result.current.refrescar() })
    await act(async () => { segunda.resolver({ data: 5, error: null }) })
    await act(async () => { primera.resolver({ data: 3, error: null }) })
    expect(result.current.conteo).toBe(5)
  })

  it('sin carreras el conteo de la respuesta se aplica', async () => {
    rpc.mockResolvedValue({ data: 4, error: null })
    const { result } = renderHook(() => useConteoSinLeer())
    await act(async () => { await Promise.resolve() })
    expect(result.current.conteo).toBe(4)
  })

  it('un doble clic sobre un aviso sin leer lo marca UNA vez y descuenta UNA vez', async () => {
    const marcado = diferida<{ data: number; error: null }>()
    rpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'contar_notificaciones_sin_leer') return { data: 2, error: null }
      if (nombre === 'listar_notificaciones') return { data: { total: 1, items: [notificacion(1)] }, error: null }
      if (nombre === 'marcar_notificaciones_leidas') return marcado.promesa
      return { data: null, error: null }
    })
    render(<CampanitaNotificaciones />)
    fireEvent.click(await screen.findByRole('button', { name: 'Notificaciones, 2 sin leer' }))
    const aviso = await screen.findByText(/Nombre: Persona 1/)
    fireEvent.click(aviso)
    fireEvent.click(aviso)
    expect(rpc.mock.calls.filter(([n]) => n === 'marcar_notificaciones_leidas')).toHaveLength(1)
    expect(await screen.findByRole('button', { name: 'Notificaciones, 1 sin leer', hidden: true })).toBeInTheDocument()
    await act(async () => { marcado.resolver({ data: 1, error: null }) })
  })
})
