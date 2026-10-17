import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  consulta: vi.fn(),
  useNivelSeccion: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    rpc: mocks.rpc,
    schema: () => ({
      from: () => ({
        select: () => ({ order: () => ({ order: () => ({ range: () => ({ returns: mocks.consulta }) }) }) }),
      }),
    }),
  },
}))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { ProductoList } from './list'

const FILAS = [
  { id: 'p-1', nombre: 'Joystick', sku: 'JOY-1', activo: true },
  { id: 'p-2', nombre: 'Cable', sku: null, activo: false },
]

const abrir = () => render(<MemoryRouter><ProductoList /></MemoryRouter>)

describe('ProductoList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.consulta.mockResolvedValue({ data: FILAS, error: null, count: 2 })
    mocks.rpc.mockResolvedValue({ data: null, error: null })
  })

  it('muestra nombre, SKU y la etiqueta «Inactivo» del producto desactivado', async () => {
    abrir()
    expect(await screen.findByText('Joystick')).toBeInTheDocument()
    expect(screen.getByText('JOY-1')).toBeInTheDocument()
    expect(screen.getByText('Activo')).toBeInTheDocument()
    expect(screen.getByText('Inactivo')).toBeInTheDocument()
  })

  it('con edición ofrece editar y activar/desactivar, y desactivar llama a la RPC y recarga', async () => {
    abrir()
    await screen.findByText('Joystick')
    expect(screen.getByRole('link', { name: 'Editar Joystick' })).toHaveAttribute('href', '/productos/p-1/edit')
    expect(screen.getByRole('button', { name: 'Activar Cable' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar Joystick' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('cambiar_estado_producto', { p_id: 'p-1', p_activo: false }))
    await waitFor(() => expect(mocks.consulta).toHaveBeenCalledTimes(2))
  })

  it('con solo lectura no ofrece editar, activar/desactivar ni «Nuevo producto»', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    abrir()
    await screen.findByText('Joystick')
    expect(screen.queryByRole('button', { name: /^(Activar|Desactivar)/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^Editar/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Nuevo producto' })).not.toBeInTheDocument()
    expect(screen.getByText('Inactivo')).toBeInTheDocument()
  })

  it('un error al cambiar el estado se avisa en castellano, sin texto crudo, y no recarga', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } })
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Desactivar Joystick' }))
    expect(await screen.findByText(/No tenés permiso para esta acción/)).toBeInTheDocument()
    expect(screen.queryByText(/row-level security/)).not.toBeInTheDocument()
    expect(mocks.consulta).toHaveBeenCalledTimes(1)
  })

  it('sin productos muestra el estado vacío', async () => {
    mocks.consulta.mockResolvedValue({ data: [], error: null, count: 0 })
    abrir()
    expect(await screen.findByText('Todavía no hay productos cargados.')).toBeInTheDocument()
  })

  it('ante un error de carga ofrece reintentar', async () => {
    mocks.consulta.mockResolvedValueOnce({ data: null, error: { message: 'boom' }, count: null })
    abrir()
    expect(await screen.findByText('No pudimos cargar los productos.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }))
    expect(await screen.findByText('Joystick')).toBeInTheDocument()
  })
})
