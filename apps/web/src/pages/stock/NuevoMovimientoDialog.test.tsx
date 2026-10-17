import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  productos: vi.fn(),
  motivos: vi.fn(),
  rpc: vi.fn(),
  getUser: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    rpc: mocks.rpc,
    auth: { getUser: mocks.getUser },
    schema: () => ({
      from: (tabla: string) =>
        tabla === 'productos'
          ? { select: () => ({ order: () => ({ order: () => ({ limit: () => ({ returns: mocks.productos }) }) }) }) }
          : { select: () => ({ eq: () => ({ order: () => ({ returns: mocks.motivos }) }) }) },
    }),
  },
}))

import { fechaDeHoy } from '../../lib/stock'
import NuevoMovimientoDialog from './NuevoMovimientoDialog'

const PRODUCTOS = [
  { id: 'p-1', nombre: 'Joystick', sku: 'JOY-1', existencias: { cantidad: 6 } },
  { id: 'p-2', nombre: 'Cable', sku: null, existencias: null },
]
const MOTIVOS = [
  { id: 'm-compra', nombre: 'Compra a proveedor', aplica_a: ['entrada'], activo: true },
  { id: 'm-venta', nombre: 'Venta en local', aplica_a: ['salida'], activo: true },
  { id: 'm-conteo', nombre: 'Conteo de inventario', aplica_a: ['ajuste'], activo: true },
]

const onCerrar = vi.fn()
const onRegistrado = vi.fn()

const abrir = async (productoId = 'p-1') => {
  render(<NuevoMovimientoDialog abierto productoId={productoId} onCerrar={onCerrar} onRegistrado={onRegistrado} />)
  await screen.findByLabelText(/Cantidad|Stock contado/)
}

const elegirMotivo = (nombre: string) => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: /Motivo/ }))
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: nombre }))
}

describe('NuevoMovimientoDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.productos.mockResolvedValue({ data: PRODUCTOS, error: null })
    mocks.motivos.mockResolvedValue({ data: MOTIVOS, error: null })
    mocks.getUser.mockResolvedValue({ data: { user: { email: 'operador@example.com' } } })
    mocks.rpc.mockResolvedValue({ data: {}, error: null })
  })

  it('registra una entrada: muestra el stock resultante, llama a la RPC y confirma «Movimiento registrado»', async () => {
    await abrir()
    expect(screen.getByText(/Responsable: operador@example.com · se registra automáticamente con fecha y hora/)).toBeInTheDocument()
    expect(screen.getByText('Stock actual: 6')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Cantidad/), { target: { value: '10' } })
    expect(screen.getByRole('status')).toHaveTextContent('Stock resultante: 16')
    elegirMotivo('Compra a proveedor')
    fireEvent.change(screen.getByLabelText(/Nota/), { target: { value: '  Primera carga ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar' }))

    expect(await screen.findByText('Movimiento registrado')).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledWith('registrar_movimiento_stock', {
      p_producto: 'p-1', p_tipo: 'entrada', p_cantidad: 10, p_motivo: 'm-compra', p_nota: 'Primera carga', p_fecha: fechaDeHoy(),
    })
    expect(onRegistrado).toHaveBeenCalledTimes(1)
  })

  it('en un ajuste pide el stock contado y la vista previa es ese valor', async () => {
    await abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Ajuste' }))
    fireEvent.change(await screen.findByLabelText(/Stock contado/), { target: { value: '3' } })
    expect(screen.getByRole('status')).toHaveTextContent('Stock resultante: 3')
    elegirMotivo('Conteo de inventario')
    fireEvent.click(screen.getByRole('button', { name: 'Registrar' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('registrar_movimiento_stock', expect.objectContaining({ p_tipo: 'ajuste', p_cantidad: 3, p_nota: null })))
  })

  it('en una salida la vista previa resta y solo se ofrecen los motivos de ese tipo', async () => {
    await abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Salida' }))
    fireEvent.change(screen.getByLabelText(/Cantidad/), { target: { value: '4' } })
    expect(screen.getByRole('status')).toHaveTextContent('Stock resultante: 2')
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Motivo/ }))
    const opciones = within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)
    expect(opciones).toEqual(['Venta en local'])
  })

  it('valida antes de enviar: sin cantidad ni motivo no llama a la RPC', async () => {
    await abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Registrar' }))
    expect(await screen.findByText('Ingresá una cantidad entera mayor a cero.')).toBeInTheDocument()
    expect(screen.getByText('Elegí un motivo.')).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('una cantidad con decimales o negativa se rechaza en el formulario', async () => {
    await abrir()
    elegirMotivo('Compra a proveedor')
    for (const valor of ['1,5', '-2', '0']) {
      fireEvent.change(screen.getByLabelText(/Cantidad/), { target: { value: valor } })
      fireEvent.click(screen.getByRole('button', { name: 'Registrar' }))
      expect(await screen.findByText('Ingresá una cantidad entera mayor a cero.')).toBeInTheDocument()
    }
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('si el servidor rechaza muestra el mensaje en castellano, sin texto crudo, y deja reintentar', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } })
    await abrir()
    fireEvent.change(screen.getByLabelText(/Cantidad/), { target: { value: '5' } })
    elegirMotivo('Compra a proveedor')
    fireEvent.click(screen.getByRole('button', { name: 'Registrar' }))
    expect(await screen.findByText(/No tenés permiso para esta acción/)).toBeInTheDocument()
    expect(screen.queryByText(/row-level security/)).not.toBeInTheDocument()
    expect(onRegistrado).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Registrar' }))
    expect(await screen.findByText('Movimiento registrado')).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
  })

  it('un doble envío registra un solo movimiento', async () => {
    let resolver: (valor: unknown) => void = () => undefined
    mocks.rpc.mockReturnValueOnce(new Promise((resolve) => { resolver = resolve }))
    await abrir()
    fireEvent.change(screen.getByLabelText(/Cantidad/), { target: { value: '5' } })
    elegirMotivo('Compra a proveedor')
    const registrar = screen.getByRole('button', { name: 'Registrar' })
    fireEvent.click(registrar)
    fireEvent.click(registrar)
    expect(await screen.findByRole('button', { name: 'Registrando…' })).toBeDisabled()
    resolver({ data: {}, error: null })
    expect(await screen.findByText('Movimiento registrado')).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it('si no puede preparar el formulario lo avisa y permite reintentar', async () => {
    mocks.motivos.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'boom' } })
    render(<NuevoMovimientoDialog abierto productoId="p-1" onCerrar={onCerrar} onRegistrado={onRegistrado} />)
    expect(await screen.findByText('No pudimos preparar el formulario.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByLabelText(/Cantidad/)).toBeInTheDocument()
  })
})
