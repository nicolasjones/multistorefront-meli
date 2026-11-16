import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  nivel: vi.fn(),
  categorias: vi.fn(),
  filas: vi.fn(),
  confirmar: vi.fn(),
  from: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabaseClient: { from: mocks.from } }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.nivel }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../lib/categorias', async (importarOriginal) => ({
  ...(await importarOriginal<typeof import('../../lib/categorias')>()),
  leerCategoriasSelector: mocks.categorias,
}))
vi.mock('../../lib/tomaInventario', async (importarOriginal) => ({
  ...(await importarOriginal<typeof import('../../lib/tomaInventario')>()),
  cargarFilasToma: mocks.filas,
  confirmarToma: mocks.confirmar,
}))

import { TomaInventario } from './toma-inventario'

const CATEGORIAS = [
  { id: 'c-1', nombre: 'Periféricos', padre_id: null, posicion: 0, empresa_ids: [] },
  { id: 'c-2', nombre: 'Vacía', padre_id: null, posicion: 1, empresa_ids: [] },
]

const FILAS = [
  { producto_id: 'p-1', nombre: 'Joystick', sku: 'JOY-1', sistema: 10 },
  { producto_id: 'p-2', nombre: 'Teclado', sku: 'TEC-1', sistema: 5 },
  { producto_id: 'p-3', nombre: 'Mouse', sku: 'MOU-1', sistema: 7 },
  { producto_id: 'p-4', nombre: 'Auriculares', sku: null, sistema: 0 },
]

const abrir = async (categoria = 'Periféricos') => {
  render(<MemoryRouter><TomaInventario /></MemoryRouter>)
  fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Categoría' }))
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: categoria }))
}

const contar = (producto: string, valor: string) =>
  fireEvent.change(screen.getByLabelText(`Contado de ${producto}`), { target: { value: valor } })

describe('TomaInventario', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.nivel.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.categorias.mockResolvedValue(CATEGORIAS)
    mocks.filas.mockImplementation(async (ids: string[]) => (ids.includes('c-2') ? [] : FILAS))
    mocks.confirmar.mockResolvedValue([
      { producto: 'p-2', diferencia: -3, saldo: 2, movimiento_id: 'm-1' },
      { producto: 'p-4', diferencia: 4, saldo: 4, movimiento_id: 'm-2' },
    ])
  })

  it('lista los 4 productos de la categoría con Producto/SKU, Stock en el sistema, Contado y Diferencia', async () => {
    await abrir()
    const tabla = await screen.findByRole('table', { name: 'Productos de la toma de inventario' })
    for (const columna of ['Producto / SKU', 'Stock en el sistema', 'Contado', 'Diferencia']) {
      expect(within(tabla).getByRole('columnheader', { name: columna })).toBeInTheDocument()
    }
    expect(within(tabla).getAllByRole('row')).toHaveLength(5)
    expect(within(tabla).getByText('JOY-1')).toBeInTheDocument()
    expect(mocks.filas).toHaveBeenCalledWith(['c-1'])
  })

  it('una categoría sin productos muestra el estado vacío', async () => {
    await abrir('Vacía')
    expect(await screen.findByText('Esta categoría no tiene productos')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirmar' })).not.toBeInTheDocument()
  })

  it('muestra la diferencia con signo (contado − sistema)', async () => {
    await abrir()
    await screen.findByRole('table')
    contar('Teclado', '2')
    contar('Auriculares', '4')
    contar('Joystick', '10')
    const fila = (nombre: string) => screen.getByText(nombre).closest('tr') as HTMLElement
    expect(within(fila('Teclado')).getByText('-3')).toBeInTheDocument()
    expect(within(fila('Auriculares')).getByText('+4')).toBeInTheDocument()
    expect(within(fila('Joystick')).getAllByText('0').length).toBeGreaterThan(0)
  })

  it('un contado inválido se rechaza y no se envía', async () => {
    await abrir()
    await screen.findByRole('table')
    contar('Teclado', '-1')
    expect(await screen.findByText('Ingresá un entero de cero o más.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    contar('Teclado', '1.5')
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(mocks.confirmar).not.toHaveBeenCalled()
  })

  it('el campo vacío no se toca: solo se envían los productos con contado', async () => {
    await abrir()
    await screen.findByRole('table')
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled()
    contar('Teclado', '2')
    contar('Auriculares', '4')
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(mocks.confirmar).toHaveBeenCalledTimes(1))
    expect(mocks.confirmar).toHaveBeenCalledWith([
      { producto: 'p-2', contado: 2 },
      { producto: 'p-4', contado: 4 },
    ])
  })

  it('muestra el resultado con los ajustes generados (producto, diferencia, saldo)', async () => {
    await abrir()
    await screen.findByRole('table')
    contar('Teclado', '2')
    contar('Auriculares', '4')
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(await screen.findByText('Toma de inventario confirmada')).toBeInTheDocument()
    const tabla = screen.getByRole('table', { name: 'Ajustes generados por la toma' })
    const filaTeclado = within(tabla).getByText('Teclado').closest('tr') as HTMLElement
    expect(within(filaTeclado).getByText('-3')).toBeInTheDocument()
    expect(within(filaTeclado).getByText('2')).toBeInTheDocument()
    const filaAuriculares = within(tabla).getByText('Auriculares').closest('tr') as HTMLElement
    expect(within(filaAuriculares).getByText('+4')).toBeInTheDocument()
  })

  it('ante un error avisa que no se guardó nada y permite reintentar', async () => {
    mocks.confirmar.mockRejectedValueOnce({ code: 'XX000', message: 'boom' })
    await abrir()
    await screen.findByRole('table')
    contar('Teclado', '2')
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(await screen.findByText(/No se guardó ningún ajuste/)).toBeInTheDocument()
    expect(screen.getByLabelText('Contado de Teclado')).toHaveValue('2')
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(await screen.findByText('Toma de inventario confirmada')).toBeInTheDocument()
    expect(mocks.confirmar).toHaveBeenCalledTimes(2)
  })

  it('sin nivel de edición no muestra «Confirmar»', async () => {
    mocks.nivel.mockReturnValue({ nivel: 'lectura', isLoading: false })
    await abrir()
    await screen.findByRole('table')
    expect(screen.getByText('Tu rol puede ver la toma, pero no confirmarla.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirmar' })).not.toBeInTheDocument()
  })

  it('no consulta por empresa: el stock es único por organización', async () => {
    await abrir()
    await screen.findByRole('table')
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.filas).toHaveBeenCalledWith(['c-1'])
  })
})
