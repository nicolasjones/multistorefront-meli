import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { DetalleActividadDialog } from './DetalleActividadDialog'

const fila = (sobre: Record<string, unknown> = {}) => ({
  id: 'ev-1',
  creado_en: '2026-10-01T03:30:00Z',
  tipo: 'usuario.rol_cambiado',
  empresa_id: null,
  empresa_nombre: null,
  actor_id: 'u-1',
  actor_nombre: 'Ana Admin',
  detalle: 'Cambió el rol de Carla: Consulta → Mostrador',
  sensible: true,
  valor_anterior: { rol: 'Consulta' },
  valor_nuevo: { rol: 'Mostrador' },
  ...sobre,
})

describe('DetalleActividadDialog (F-AUD-02, FR-007)', () => {
  beforeEach(() => mocks.rpc.mockReset())

  it('muestra campo por campo el valor anterior y el nuevo, sin identificadores', async () => {
    mocks.rpc.mockResolvedValue({ data: [fila()], error: null })
    render(<DetalleActividadDialog eventoId="ev-1" onCerrar={() => undefined} />)

    const tabla = await screen.findByRole('table', { name: 'Valores del cambio' })
    expect(mocks.rpc).toHaveBeenCalledWith('obtener_detalle_actividad', { p_id: 'ev-1' })
    expect(within(tabla).getByRole('columnheader', { name: 'Antes' })).toBeInTheDocument()
    expect(within(tabla).getByRole('columnheader', { name: 'Después' })).toBeInTheDocument()
    expect(within(tabla).getByText('Rol')).toBeInTheDocument()
    expect(within(tabla).getByText('Consulta')).toBeInTheDocument()
    expect(within(tabla).getByText('Mostrador')).toBeInTheDocument()
    expect(screen.getByText('Cambio de rol')).toBeInTheDocument()
    expect(screen.getByText('Ana Admin')).toBeInTheDocument()
    expect(screen.getByText('01/10/2026 00:30')).toBeInTheDocument()
    expect(screen.queryByText(/ev-1|u-1/)).not.toBeInTheDocument()
  })

  it('es solo consulta: no ofrece deshacer ni editar', async () => {
    mocks.rpc.mockResolvedValue({ data: [fila()], error: null })
    render(<DetalleActividadDialog eventoId="ev-1" onCerrar={() => undefined} />)
    await screen.findByRole('table', { name: 'Valores del cambio' })

    expect(screen.queryByRole('button', { name: /deshacer|revertir|editar/i })).not.toBeInTheDocument()
  })

  it('un evento sin valores lo dice, sin error', async () => {
    mocks.rpc.mockResolvedValue({ data: [fila({ sensible: false, valor_anterior: null, valor_nuevo: null })], error: null })
    render(<DetalleActividadDialog eventoId="ev-1" onCerrar={() => undefined} />)

    expect(await screen.findByText('Este evento no tiene valores registrados.')).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Valores del cambio' })).not.toBeInTheDocument()
    expect(screen.queryByText(/No pudimos cargar/)).not.toBeInTheDocument()
  })

  it('una baja (nuevo vacío) muestra «—» del lado nuevo', async () => {
    mocks.rpc.mockResolvedValue({ data: [fila({ tipo: 'usuario.removido', valor_anterior: { rol: 'Consulta' }, valor_nuevo: {} })], error: null })
    render(<DetalleActividadDialog eventoId="ev-1" onCerrar={() => undefined} />)

    const tabla = await screen.findByRole('table', { name: 'Valores del cambio' })
    expect(within(tabla).getByText('—')).toBeInTheDocument()
  })

  it('la baja real (rol y estado antes, nuevo vacío) muestra «—» en cada fila del lado nuevo', async () => {
    mocks.rpc.mockResolvedValue({ data: [fila({ tipo: 'usuario.removido', valor_anterior: { rol: 'Consulta', estado: 'Miembro' }, valor_nuevo: {} })], error: null })
    render(<DetalleActividadDialog eventoId="ev-1" onCerrar={() => undefined} />)

    const tabla = await screen.findByRole('table', { name: 'Valores del cambio' })
    expect(within(tabla).getByText('Consulta')).toBeInTheDocument()
    expect(within(tabla).getByText('Miembro')).toBeInTheDocument()
    expect(within(tabla).getAllByText('—')).toHaveLength(2)
  })

  it('un alta (anterior vacío) muestra «—» del lado anterior', async () => {
    mocks.rpc.mockResolvedValue({ data: [fila({ tipo: 'usuario.agregado', valor_anterior: {}, valor_nuevo: { rol: 'Operador' } })], error: null })
    render(<DetalleActividadDialog eventoId="ev-1" onCerrar={() => undefined} />)

    const tabla = await screen.findByRole('table', { name: 'Valores del cambio' })
    expect(within(tabla).getByText('Operador')).toBeInTheDocument()
    expect(within(tabla).getAllByText('—')).toHaveLength(1)
  })

  it('si no devuelve filas avisa que el evento ya no está disponible', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    render(<DetalleActividadDialog eventoId="ev-1" onCerrar={() => undefined} />)

    expect(await screen.findByText('Este evento ya no está disponible.')).toBeInTheDocument()
  })

  it('ante un error ofrece reintentar', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'x' } }).mockResolvedValueOnce({ data: [fila()], error: null })
    render(<DetalleActividadDialog eventoId="ev-1" onCerrar={() => undefined} />)

    fireEvent.click(await screen.findByRole('button', { name: /reintentar/i }))
    expect(await screen.findByRole('table', { name: 'Valores del cambio' })).toBeInTheDocument()
  })

  it('se cierra con el botón Cerrar', async () => {
    mocks.rpc.mockResolvedValue({ data: [fila()], error: null })
    const onCerrar = vi.fn()
    render(<DetalleActividadDialog eventoId="ev-1" onCerrar={onCerrar} />)
    await screen.findByRole('table', { name: 'Valores del cambio' })

    fireEvent.click(screen.getAllByRole('button', { name: 'Cerrar' })[0])
    expect(onCerrar).toHaveBeenCalled()
  })
})
