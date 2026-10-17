import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  productos: vi.fn(),
  costos: vi.fn(),
  imagenes: vi.fn(),
  useNivelSeccion: vi.fn(),
  firmarImagenes: vi.fn(),
}))

const cadena = (terminal: (...args: Array<unknown>) => unknown) => {
  const eslabon: Record<string, (...args: Array<unknown>) => unknown> = {
    or: () => eslabon,
    eq: () => eslabon,
    in: () => eslabon,
    order: () => eslabon,
    range: () => eslabon,
    returns: terminal,
  }
  return eslabon
}

vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    rpc: mocks.rpc,
    schema: () => ({
      from: (tabla: string) => ({
        select: () => cadena(
          tabla === 'productos' ? mocks.productos
            : tabla === 'producto_costos' ? mocks.costos
              : mocks.imagenes,
        ),
      }),
    }),
  },
}))
vi.mock('../../lib/productoImagenes', () => ({ firmarImagenes: mocks.firmarImagenes }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { ProductoList } from './list'

const FILAS = [
  { id: 'p-1', nombre: 'Joystick', sku: 'JOY-1', precio_lista: 200, moneda: 'USD', activo: true },
  { id: 'p-2', nombre: 'Cable', sku: null, activo: false, precio_lista: 50, moneda: 'ARS' },
]

const abrir = () => render(<MemoryRouter><ProductoList /></MemoryRouter>)

describe('ProductoList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.productos.mockResolvedValue({ data: FILAS, error: null, count: 2 })
    mocks.costos.mockResolvedValue({ data: [{ producto_id: 'p-1', costo: 100 }], error: null })
    mocks.imagenes.mockResolvedValue({
      data: [{ id: 'i-1', producto_id: 'p-1', posicion: 0, ruta: 'org/p-1/0.jpg' }],
      error: null,
    })
    mocks.firmarImagenes.mockImplementation(async (_cliente: unknown, filas: Array<{ ruta: string }>) =>
      filas.map((fila) => ({ ...fila, url: `https://firmada.test/${fila.ruta}` }),
      ))
    mocks.rpc.mockResolvedValue({ data: null, error: null })
  })

  it('muestra producto combinado, precio, costo y margen con foto firmada', async () => {
    abrir()
    expect(await screen.findByText('Joystick')).toBeInTheDocument()
    expect(screen.getByText('JOY-1')).toBeInTheDocument()
    expect(screen.getByText('$ 200')).toBeInTheDocument()
    expect(screen.getByText('USD')).toBeInTheDocument()
    expect(screen.getByText('$ 100')).toBeInTheDocument()
    expect(screen.getByText('50,0 %')).toBeInTheDocument()
    expect(screen.getByText('Activo')).toBeInTheDocument()
    expect(screen.getByText('Inactivo')).toBeInTheDocument()
    const fila = (await screen.findByText('Joystick')).closest('tr') as HTMLElement
    expect(within(fila).getByRole('presentation', { hidden: true })).toHaveAttribute(
      'src', 'https://firmada.test/org/p-1/0.jpg',
    )
  })

  it('sin costo cargado muestra «—» en costo y margen', async () => {
    abrir()
    await screen.findByText('Cable')
    const fila = screen.getByText('Cable').closest('tr') as HTMLElement
    expect(within(fila).getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })

  it('con edición ofrece editar y activar/desactivar, y desactivar llama a la RPC y recarga', async () => {
    abrir()
    await screen.findByText('Joystick')
    expect(screen.getByRole('link', { name: 'Editar Joystick' })).toHaveAttribute('href', '/productos/p-1/edit')
    expect(screen.getByRole('button', { name: 'Activar Cable' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar Joystick' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('cambiar_estado_producto', { p_id: 'p-1', p_activo: false }))
    await waitFor(() => expect(mocks.productos).toHaveBeenCalledTimes(2))
  })

  it('con solo lectura no ofrece editar, activar/desactivar ni «Nuevo producto»', async () => {
    mocks.useNivelSeccion.mockImplementation((seccion: string) =>
      seccion === 'rentabilidad'
        ? { nivel: null, isLoading: false }
        : { nivel: 'lectura', isLoading: false },
    )
    abrir()
    await screen.findByText('Joystick')
    expect(screen.queryByRole('button', { name: /^(Activar|Desactivar)/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^Editar/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Nuevo producto' })).not.toBeInTheDocument()
    expect(screen.getByText('Inactivo')).toBeInTheDocument()
  })

  it('sin lectura en Rentabilidad no muestra Costo ni Margen', async () => {
    mocks.useNivelSeccion.mockImplementation((seccion: string) =>
      seccion === 'rentabilidad'
        ? { nivel: null, isLoading: false }
        : { nivel: 'edicion', isLoading: false },
    )
    abrir()
    await screen.findByText('Joystick')
    expect(screen.queryByText('Costo')).not.toBeInTheDocument()
    expect(screen.queryByText('Margen')).not.toBeInTheDocument()
    expect(mocks.costos).not.toHaveBeenCalled()
  })

  it('el buscador filtra por nombre o SKU tras la espera', async () => {
    abrir()
    await screen.findByText('Joystick')
    fireEvent.change(screen.getByLabelText(/buscar productos/i), { target: { value: 'joy' } })
    await waitFor(() => expect(mocks.productos).toHaveBeenCalledTimes(2))
  })

  it('el filtro de estado pide solo inactivos', async () => {
    abrir()
    await screen.findByText('Joystick')
    fireEvent.click(screen.getByRole('button', { name: 'Inactivos' }))
    await waitFor(() => expect(mocks.productos).toHaveBeenCalledTimes(2))
  })

  it('un error al cambiar el estado se avisa en castellano, sin texto crudo, y no recarga', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } })
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Desactivar Joystick' }))
    expect(await screen.findByText(/No tenés permiso para esta acción/)).toBeInTheDocument()
    expect(screen.queryByText(/row-level security/)).not.toBeInTheDocument()
    expect(mocks.productos).toHaveBeenCalledTimes(1)
  })

  it('sin productos muestra el estado vacío', async () => {
    mocks.productos.mockResolvedValue({ data: [], error: null, count: 0 })
    abrir()
    expect(await screen.findByText('Todavía no hay productos cargados.')).toBeInTheDocument()
  })

  it('ante un error de carga ofrece reintentar', async () => {
    mocks.productos.mockResolvedValueOnce({ data: null, error: { message: 'boom' }, count: null })
    abrir()
    expect(await screen.findByText('No pudimos cargar los productos.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }))
    expect(await screen.findByText('Joystick')).toBeInTheDocument()
  })
})
