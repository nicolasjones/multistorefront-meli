import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  productos: vi.fn(),
  resumen: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    rpc: mocks.rpc,
    from: () => {
      const constructor = {
        select: () => constructor,
        eq: () => constructor,
        order: () => constructor,
        limit: () => constructor,
        returns: mocks.resumen,
      }
      return constructor
    },
    schema: () => ({
      from: () => ({
        select: () => ({ order: () => ({ limit: () => ({ returns: mocks.productos }) }) }),
      }),
    }),
  },
}))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { MovimientosStock } from './movimientos'

const fila = (extra: Record<string, unknown>) => ({
  id: 'm-1',
  fecha: '2026-10-17',
  creado_en: '2026-10-17T12:00:00Z',
  producto_id: 'p-1',
  producto_nombre: 'Joystick Pro',
  producto_sku: 'JOY-1',
  tipo: 'entrada',
  motivo: 'Compra a proveedor',
  nota: null,
  cantidad: 10,
  diferencia: 10,
  saldo: 10,
  responsable: 'operador@example.com',
  deposito_id: 'dep-1',
  deposito_nombre: 'Depósito principal',
  traslado_id: null,
  total: 3,
  ...extra,
})

const FILAS = [
  fila({ id: 'm-3', tipo: 'ajuste', cantidad: 3, diferencia: -3, saldo: 3, motivo: 'Conteo de inventario', nota: 'Recuento de fin de mes' }),
  fila({ id: 'm-2', tipo: 'salida', cantidad: 4, diferencia: -4, saldo: 6, motivo: 'Venta en local' }),
  fila({ id: 'm-1' }),
]

const abrir = () => render(<MemoryRouter><MovimientosStock /></MemoryRouter>)

describe('MovimientosStock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.rpc.mockResolvedValue({ data: FILAS, error: null })
    mocks.productos.mockResolvedValue({ data: [{ id: 'p-1', nombre: 'Joystick Pro', sku: 'JOY-1' }], error: null })
    mocks.resumen.mockResolvedValue({
      data: [{ producto_id: 'p-1', nombre: 'Joystick Pro', sku: 'JOY-1', cantidad: 10, reservado: 3, disponible: 7, estado: 'disponible' }],
      error: null,
    })
  })

  it('lista los movimientos en el orden del servidor con nombre, SKU, motivo, nota, saldo y responsable', async () => {
    abrir()
    const tabla = await screen.findByRole('table', { name: 'Historial de movimientos de stock' })
    const filas = within(tabla).getAllByRole('row').slice(1)
    expect(filas).toHaveLength(3)
    expect(within(filas[0]).getByText('Ajuste')).toBeInTheDocument()
    expect(within(filas[0]).getByText('Recuento de fin de mes')).toBeInTheDocument()
    expect(within(filas[0]).getByText('Diferencia -3')).toBeInTheDocument()
    expect(within(filas[1]).getByText('Salida')).toBeInTheDocument()
    expect(within(filas[2]).getByText('Entrada')).toBeInTheDocument()
    expect(within(filas[2]).getByText('Joystick Pro')).toBeInTheDocument()
    expect(within(filas[2]).getByText('JOY-1')).toBeInTheDocument()
    expect(within(filas[2]).getAllByText('10').length).toBeGreaterThan(0)
    expect(within(filas[2]).getByText('operador@example.com')).toBeInTheDocument()
    expect(within(filas[2]).getByText('Depósito principal')).toBeInTheDocument()
    expect(within(filas[2]).getByText('17/10/2026')).toBeInTheDocument()
    expect(screen.getByText('3 movimientos')).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledWith('listar_movimientos_stock', { p_producto: null, p_limite: 25, p_desplazamiento: 0 })
  })

  it('los dos movimientos del traslado se distinguen y muestran su depósito', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        fila({ id: 'm-t2', tipo: 'entrada', motivo: 'Traslado entre depósitos', cantidad: 4, diferencia: 4, saldo: 10, deposito_id: 'dep-2', deposito_nombre: 'Depósito Sur', traslado_id: 't-1', total: 3 }),
        fila({ id: 'm-t1', tipo: 'salida', motivo: 'Traslado entre depósitos', cantidad: 4, diferencia: -4, saldo: 6, deposito_id: 'dep-1', deposito_nombre: 'Depósito principal', traslado_id: 't-1', total: 3 }),
        fila({ id: 'm-0', total: 3 }),
      ],
      error: null,
    })
    abrir()
    const tabla = await screen.findByRole('table', { name: 'Historial de movimientos de stock' })
    const filas = within(tabla).getAllByRole('row').slice(1)
    expect(within(filas[0]).getByText('Traslado · Entrada')).toBeInTheDocument()
    expect(within(filas[0]).getByText('Depósito Sur')).toBeInTheDocument()
    expect(within(filas[1]).getByText('Traslado · Salida')).toBeInTheDocument()
    expect(within(filas[1]).getByText('Depósito principal')).toBeInTheDocument()
    expect(within(filas[2]).getByText('Entrada')).toBeInTheDocument()
  })

  it('muestra el resumen por producto con Queda, Reserv. y Disp.', async () => {
    abrir()
    const resumen = await screen.findByRole('table', { name: 'Resumen por producto' })
    expect(within(resumen).getByRole('columnheader', { name: 'Queda' })).toBeInTheDocument()
    expect(within(resumen).getByRole('columnheader', { name: 'Reserv.' })).toBeInTheDocument()
    expect(within(resumen).getByRole('columnheader', { name: 'Disp.' })).toBeInTheDocument()
    const filaResumen = within(resumen).getAllByRole('row')[1]
    expect(within(filaResumen).getByText('10')).toBeInTheDocument()
    expect(within(filaResumen).getByText('3')).toBeInTheDocument()
    expect(within(filaResumen).getByText('7')).toBeInTheDocument()
  })

  it('es de solo lectura: no ofrece botones de registrar, editar ni borrar', async () => {
    abrir()
    await screen.findByRole('table', { name: 'Historial de movimientos de stock' })
    expect(screen.queryByRole('button', { name: /nuevo movimiento|editar|borrar|eliminar/i })).not.toBeInTheDocument()
    expect(screen.getByText(/solo lectura/i)).toBeInTheDocument()
  })

  it('pide la página siguiente al servidor con el desplazamiento correcto', async () => {
    mocks.rpc.mockResolvedValue({ data: FILAS.map((f) => ({ ...f, total: 60 })), error: null })
    abrir()
    await screen.findByRole('table', { name: 'Historial de movimientos de stock' })
    fireEvent.click(screen.getByRole('button', { name: /next page|página siguiente|go to next page/i }))
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenLastCalledWith('listar_movimientos_stock', { p_producto: null, p_limite: 25, p_desplazamiento: 25 }),
    )
  })

  it('filtra por producto y vuelve a la primera página', async () => {
    abrir()
    await screen.findByRole('table', { name: 'Historial de movimientos de stock' })
    const filtro = screen.getByRole('combobox', { name: 'Filtrar por producto' })
    fireEvent.mouseDown(filtro)
    fireEvent.click(await screen.findByRole('option', { name: 'Joystick Pro · JOY-1' }))
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenLastCalledWith('listar_movimientos_stock', { p_producto: 'p-1', p_limite: 25, p_desplazamiento: 0 }),
    )
  })

  it('muestra el estado vacío', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    mocks.resumen.mockResolvedValue({ data: [], error: null })
    abrir()
    expect(await screen.findByText('Todavía no hay movimientos de stock.')).toBeInTheDocument()
  })

  it('muestra el error y reintenta', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error('falló') })
    abrir()
    expect(await screen.findByText('No pudimos cargar el historial de movimientos.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('table', { name: 'Historial de movimientos de stock' })).toBeInTheDocument()
  })

  it('sin acceso a Catálogo el historial igual se ve (producto no disponible)', async () => {
    mocks.productos.mockResolvedValue({ data: [], error: null })
    mocks.rpc.mockResolvedValue({ data: [fila({ producto_nombre: null, producto_sku: null })], error: null })
    abrir()
    expect(await screen.findByText('Producto no disponible')).toBeInTheDocument()
  })

  it('enlaza las pestañas Stock actual y Movimientos', async () => {
    abrir()
    await screen.findByRole('table', { name: 'Historial de movimientos de stock' })
    expect(screen.getByRole('tab', { name: 'Stock actual' })).toHaveAttribute('href', '/stock')
    expect(screen.getByRole('tab', { name: 'Movimientos' })).toHaveAttribute('aria-selected', 'true')
  })
})
