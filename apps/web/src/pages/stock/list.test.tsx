import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  consulta: vi.fn(),
  useNivelSeccion: vi.fn(),
  usePuedeEscribir: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    schema: () => ({
      from: () => ({
        select: () => ({ order: () => ({ order: () => ({ range: () => ({ returns: mocks.consulta }) }) }) }),
      }),
    }),
  },
}))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: mocks.usePuedeEscribir }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('./NuevoMovimientoDialog', () => ({
  default: (props: { productoId?: string; onCerrar: () => void; onRegistrado: () => void }) => (
    <div role="dialog" aria-label="Registrar movimiento de stock">
      <span>producto:{props.productoId || 'ninguno'}</span>
      <button type="button" onClick={props.onRegistrado}>simular registrado</button>
      <button type="button" onClick={props.onCerrar}>simular cierre</button>
    </div>
  ),
}))

import { StockList } from './list'

const FILAS = [
  { id: 'p-1', nombre: 'Joystick', sku: 'JOY-1', existencias: { cantidad: 6 } },
  { id: 'p-2', nombre: 'Cable', sku: null, existencias: [{ cantidad: 0 }] },
  { id: 'p-3', nombre: 'Mouse', sku: 'MOU-1', existencias: null },
]

const abrir = () => render(<MemoryRouter><StockList /></MemoryRouter>)

describe('StockList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: false, isLoading: false })
    mocks.consulta.mockResolvedValue({ data: FILAS, error: null, count: 3 })
  })

  it('muestra producto, SKU y cantidad (0 si no hay fila de existencias)', async () => {
    abrir()
    expect(await screen.findByText('Joystick')).toBeInTheDocument()
    expect(screen.getByText('JOY-1')).toBeInTheDocument()
    expect(screen.getByText('6')).toBeInTheDocument()
    expect(screen.getAllByText('0')).toHaveLength(2)
    expect(screen.getByText('3 productos')).toBeInTheDocument()
  })

  it('con edición ofrece «Nuevo movimiento» general y por fila, y abre el diálogo con el producto', async () => {
    abrir()
    await screen.findByText('Joystick')
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo movimiento' }))
    expect(await screen.findByText('producto:ninguno')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'simular cierre' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo movimiento de Cable' }))
    expect(await screen.findByText('producto:p-2')).toBeInTheDocument()
  })

  it('al registrar un movimiento recarga el listado', async () => {
    abrir()
    await screen.findByText('Joystick')
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo movimiento' }))
    fireEvent.click(await screen.findByRole('button', { name: 'simular registrado' }))
    await waitFor(() => expect(mocks.consulta).toHaveBeenCalledTimes(2))
  })

  it('con solo lectura (Consulta) ve las cantidades sin ningún botón de movimiento', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    abrir()
    await screen.findByText('Joystick')
    expect(screen.queryByRole('button', { name: /Nuevo movimiento/ })).not.toBeInTheDocument()
    expect(screen.getByText('6')).toBeInTheDocument()
  })

  it('el acceso a Motivos aparece solo para quien puede administrarlos', async () => {
    abrir()
    await screen.findByText('Joystick')
    expect(screen.queryByRole('link', { name: 'Motivos de movimiento' })).not.toBeInTheDocument()
  })

  it('el Administrador ve el enlace a /stock/motivos', async () => {
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: true, isLoading: false })
    abrir()
    await screen.findByText('Joystick')
    expect(screen.getByRole('link', { name: 'Motivos de movimiento' })).toHaveAttribute('href', '/stock/motivos')
  })

  it('sin productos muestra el estado vacío', async () => {
    mocks.consulta.mockResolvedValue({ data: [], error: null, count: 0 })
    abrir()
    expect(await screen.findByText('Todavía no hay productos para llevar stock.')).toBeInTheDocument()
  })

  it('un error de carga se avisa en castellano y permite reintentar', async () => {
    mocks.consulta.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'boom' }, count: null })
    abrir()
    expect(await screen.findByText('No pudimos cargar el stock.')).toBeInTheDocument()
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Joystick')).toBeInTheDocument()
  })
})
