import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  productos: vi.fn(),
  motivos: vi.fn(),
  rpc: vi.fn(),
  getUser: vi.fn(),
  perfil: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    rpc: mocks.rpc,
    auth: { getUser: mocks.getUser },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.perfil }) }) }),
    schema: () => ({
      from: (tabla: string) =>
        tabla === 'productos'
          ? { select: () => ({ order: () => ({ order: () => ({ limit: () => ({ returns: mocks.productos }) }) }) }) }
          : { select: () => ({ eq: () => ({ order: () => ({ returns: mocks.motivos }) }) }) },
    }),
  },
}))

import NuevoMovimientoDialog from './NuevoMovimientoDialog'

// F-STK-06 (FR-018, SC-005): aviso de stock insuficiente y bloqueo de «Registrar».
const MOTIVOS = [
  { id: 'm-compra', nombre: 'Compra a proveedor', aplica_a: ['entrada'], activo: true },
  { id: 'm-venta', nombre: 'Venta en local', aplica_a: ['salida'], activo: true },
  { id: 'm-conteo', nombre: 'Conteo de inventario', aplica_a: ['ajuste'], activo: true },
]
const productosConStock = (cantidad: number) => ({
  data: [{ id: 'p-1', nombre: 'Joystick', sku: 'JOY-1', existencias: { cantidad } }],
  error: null,
})

const abrir = async () => {
  render(<NuevoMovimientoDialog abierto productoId="p-1" onCerrar={vi.fn()} onRegistrado={vi.fn()} />)
  await screen.findByLabelText(/Cantidad|Stock contado/)
}
const elegirTipo = (nombre: string) => fireEvent.click(screen.getByRole('button', { name: nombre }))
const elegirMotivo = (nombre: string) => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: /Motivo/ }))
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: nombre }))
}
const escribirCantidad = (valor: string) => fireEvent.change(screen.getByLabelText(/Cantidad|Stock contado/), { target: { value: valor } })
const registrar = () => screen.getByRole('button', { name: 'Registrar' })

describe('NuevoMovimientoDialog · stock insuficiente', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.productos.mockResolvedValue(productosConStock(3))
    mocks.motivos.mockResolvedValue({ data: MOTIVOS, error: null })
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'u-1', email: 'operador@example.com' } } })
    mocks.perfil.mockResolvedValue({ data: { nombre: 'Ana', apellido: 'Pérez' }, error: null })
    mocks.rpc.mockResolvedValue({ data: {}, error: null })
  })

  it('una salida mayor al stock muestra el aviso con el detalle y deshabilita «Registrar»', async () => {
    await abrir()
    elegirTipo('Salida')
    escribirCantidad('5')
    const aviso = await screen.findByRole('status')
    expect(within(aviso).getByText('No hay stock suficiente')).toBeInTheDocument()
    expect(within(aviso).getByText(/Hay 3 unidades y la salida es de 5/)).toBeInTheDocument()
    expect(aviso).toHaveAttribute('id', 'aviso-stock-insuficiente')
    expect(screen.getByLabelText(/Cantidad/)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText(/Cantidad/)).toHaveAttribute('aria-describedby', 'aviso-stock-insuficiente')
    expect(registrar()).toBeDisabled()
    expect(screen.queryByText(/Stock resultante/)).not.toBeInTheDocument()
  })

  it('al bajar la cantidad hasta el stock el aviso desaparece y se puede registrar', async () => {
    await abrir()
    elegirTipo('Salida')
    escribirCantidad('5')
    await screen.findByText('No hay stock suficiente')
    escribirCantidad('3')
    await waitFor(() => expect(screen.queryByText('No hay stock suficiente')).not.toBeInTheDocument())
    expect(registrar()).toBeEnabled()
    expect(screen.getByText(/Stock resultante/)).toBeInTheDocument()
  })

  it('una entrada o un ajuste no disparan el aviso', async () => {
    await abrir()
    escribirCantidad('50')
    expect(screen.queryByText('No hay stock suficiente')).not.toBeInTheDocument()
    elegirTipo('Ajuste')
    escribirCantidad('0')
    expect(screen.queryByText('No hay stock suficiente')).not.toBeInTheDocument()
    expect(registrar()).toBeEnabled()
  })

  it('con stock 1 el detalle usa el singular', async () => {
    mocks.productos.mockResolvedValue(productosConStock(1))
    await abrir()
    elegirTipo('Salida')
    escribirCantidad('2')
    expect(await screen.findByText(/Hay 1 unidad y la salida es de 2/)).toBeInTheDocument()
  })

  it('si el servidor rechaza por carrera muestra el mismo mensaje, relee el stock y permite reintentar', async () => {
    await abrir()
    elegirTipo('Salida')
    escribirCantidad('2')
    elegirMotivo('Venta en local')
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '23514', message: 'No hay stock suficiente', details: 'Hay 1 unidad y la salida es de 2.' },
    })
    // Otro usuario ya consumió stock: la relectura trae 1 unidad.
    mocks.productos.mockResolvedValue(productosConStock(1))
    fireEvent.click(registrar())

    expect(await screen.findByText(/No hay stock suficiente\. El stock cambió/)).toBeInTheDocument()
    expect(screen.queryByText('Hay 1 unidad y la salida es de 2.')).not.toBeInTheDocument()
    // Con el stock releído, el aviso en vivo bloquea hasta corregir la cantidad.
    await waitFor(() => expect(registrar()).toBeDisabled())
    escribirCantidad('1')
    await waitFor(() => expect(registrar()).toBeEnabled())
    fireEvent.click(registrar())
    expect(await screen.findByText('Movimiento registrado')).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
  })
})
