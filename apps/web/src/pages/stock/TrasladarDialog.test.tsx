import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  depositos: vi.fn(),
  stockDeposito: vi.fn(),
}))

vi.mock('../../lib/depositos', () => ({
  listarDepositosActivos: mocks.depositos,
  listarStockPorDeposito: mocks.stockDeposito,
}))
vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { fechaDeHoy } from '../../lib/stock'
import TrasladarDialog from './TrasladarDialog'

const PRODUCTO = { id: 'p-1', nombre: 'Joystick', sku: 'JOY-1' }
const onCerrar = vi.fn()
const onRegistrado = vi.fn()

const abrir = async () => {
  render(<TrasladarDialog producto={PRODUCTO} onCerrar={onCerrar} onRegistrado={onRegistrado} />)
  await screen.findByLabelText(/Cantidad/)
}

const elegirDestino = (nombre: string) => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: /Depósito de destino/ }))
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: nombre }))
}

describe('TrasladarDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.depositos.mockResolvedValue([
      { id: 'dep-1', nombre: 'Depósito principal', por_defecto: true },
      { id: 'dep-2', nombre: 'Depósito Sur', por_defecto: false },
    ])
    mocks.stockDeposito.mockResolvedValue({
      'dep-1': { deposito_id: 'dep-1', cantidad: 10, reservado: 3, disponible: 7 },
      'dep-2': { deposito_id: 'dep-2', cantidad: 2, reservado: 0, disponible: 2 },
    })
    mocks.rpc.mockResolvedValue({
      data: [{ traslado_id: 't-1', movimiento_salida_id: 'm-1', movimiento_entrada_id: 'm-2', origen_cantidad: 6, origen_disponible: 3, destino_cantidad: 6, destino_disponible: 6 }],
      error: null,
    })
  })

  it('ofrece los campos Producto, origen, destino, Cantidad, Fecha y Nota, y el origen por defecto', async () => {
    await abrir()
    expect(screen.getByLabelText('Producto')).toHaveValue('Joystick · JOY-1')
    expect(screen.getByRole('combobox', { name: /Depósito de origen/ })).toHaveTextContent('Depósito principal (por defecto)')
    expect(screen.getByRole('combobox', { name: /Depósito de destino/ })).toBeInTheDocument()
    expect(screen.getByLabelText(/Cantidad/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Fecha/)).toHaveValue(fechaDeHoy())
    expect(screen.getByLabelText(/Nota/)).toBeInTheDocument()
  })

  it('muestra el disponible del origen (cantidad menos reservado)', async () => {
    await abrir()
    expect(screen.getByText('Disponible en Depósito principal: 7 · Stock 10 · Reservado 3')).toBeInTheDocument()
  })

  it('traslada: llama a la RPC con los datos normalizados y confirma «Traslado registrado» con ambos depósitos', async () => {
    await abrir()
    elegirDestino('Depósito Sur')
    fireEvent.change(screen.getByLabelText(/Cantidad/), { target: { value: '4' } })
    fireEvent.change(screen.getByLabelText(/Nota/), { target: { value: '  Reposición ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Trasladar' }))

    expect(await screen.findByText('Traslado registrado')).toBeInTheDocument()
    expect(screen.getByText(/Depósito principal queda con 6 \(disponible 3\) y Depósito Sur con 6 \(disponible 6\)/)).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledWith('trasladar_stock', {
      p_producto: 'p-1', p_origen: 'dep-1', p_destino: 'dep-2', p_cantidad: 4, p_nota: 'Reposición', p_fecha: fechaDeHoy(),
    })
    expect(onRegistrado).toHaveBeenCalledTimes(1)
  })

  it('avisa «No hay stock suficiente» si la cantidad pasa el disponible del origen y no llama a la RPC', async () => {
    await abrir()
    elegirDestino('Depósito Sur')
    fireEvent.change(screen.getByLabelText(/Cantidad/), { target: { value: '8' } })
    expect(screen.getByRole('alert')).toHaveTextContent('No hay stock suficiente')
    expect(screen.getByRole('alert')).toHaveTextContent('Hay 7 unidades disponibles en el origen y el traslado es de 8.')
    const boton = screen.getByRole('button', { name: 'Trasladar' })
    expect(boton).toBeDisabled()
    fireEvent.click(boton)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('valida destino, cantidad y destino distinto del origen con mensajes claros', async () => {
    await abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Trasladar' }))
    expect(await screen.findByText('Elegí el depósito de destino.')).toBeInTheDocument()
    expect(screen.getByText('Ingresá una cantidad entera mayor a cero.')).toBeInTheDocument()

    elegirDestino('Depósito principal (por defecto)')
    fireEvent.click(screen.getByRole('button', { name: 'Trasladar' }))
    expect(await screen.findByText('El destino debe ser distinto del origen.')).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('rechaza cantidades 0, negativas o decimales', async () => {
    await abrir()
    elegirDestino('Depósito Sur')
    for (const valor of ['0', '-2', '1.5']) {
      fireEvent.change(screen.getByLabelText(/Cantidad/), { target: { value: valor } })
      fireEvent.click(screen.getByRole('button', { name: 'Trasladar' }))
      expect(await screen.findByText('Ingresá una cantidad entera mayor a cero.')).toBeInTheDocument()
    }
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('rechaza una fecha futura', async () => {
    await abrir()
    elegirDestino('Depósito Sur')
    fireEvent.change(screen.getByLabelText(/Cantidad/), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/Fecha/), { target: { value: '2999-01-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Trasladar' }))
    expect(await screen.findByText('La fecha no puede ser futura.')).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('si la base rechaza por carrera, muestra el mensaje en castellano y vuelve a leer el stock', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '23514', message: 'No hay stock suficiente' } })
    await abrir()
    elegirDestino('Depósito Sur')
    fireEvent.change(screen.getByLabelText(/Cantidad/), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Trasladar' }))
    expect(await screen.findByText(/El stock cambió mientras cargabas el traslado/)).toBeInTheDocument()
    await waitFor(() => expect(mocks.stockDeposito).toHaveBeenCalledTimes(2))
    expect(onRegistrado).not.toHaveBeenCalled()
  })

  it('no muestra textos crudos de Postgres', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'relation "dominio.x" violates policy' } })
    await abrir()
    elegirDestino('Depósito Sur')
    fireEvent.change(screen.getByLabelText(/Cantidad/), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Trasladar' }))
    expect(await screen.findByText('No pudimos registrar el traslado. Intentá de nuevo.')).toBeInTheDocument()
    expect(screen.queryByText(/violates policy/)).not.toBeInTheDocument()
  })

  it('con un solo depósito activo avisa y no permite trasladar', async () => {
    mocks.depositos.mockResolvedValue([{ id: 'dep-1', nombre: 'Depósito principal', por_defecto: true }])
    render(<TrasladarDialog producto={PRODUCTO} onCerrar={onCerrar} onRegistrado={onRegistrado} />)
    expect(await screen.findByText(/necesitás al menos dos depósitos activos/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trasladar' })).toBeDisabled()
  })

  it('si falla la lectura del stock ofrece reintentar y no deja trasladar', async () => {
    mocks.stockDeposito.mockRejectedValueOnce(new Error('red'))
    render(<TrasladarDialog producto={PRODUCTO} onCerrar={onCerrar} onRegistrado={onRegistrado} />)
    expect(await screen.findByText('No pudimos preparar el traslado.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }))
    expect(await screen.findByLabelText(/Cantidad/)).toBeInTheDocument()
  })

  it('es un diálogo accesible con título, foco dentro y cierre con Escape', async () => {
    await abrir()
    const dialogo = screen.getByRole('dialog', { name: 'Trasladar stock entre depósitos' })
    // MUI deja el foco en el contenedor del diálogo (padre del papel): dentro del modal.
    expect(dialogo.closest('[role="presentation"]')).toContainElement(document.activeElement as HTMLElement)
    fireEvent.keyDown(dialogo, { key: 'Escape' })
    await waitFor(() => expect(onCerrar).toHaveBeenCalled())
  })
})
