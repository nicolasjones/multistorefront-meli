import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { ConfirmarFacturaDialog } from './ConfirmarFacturaDialog'
import type { Comprobante } from '../../lib/ventas'
import type { LineaComprobante } from '../../lib/ventasLineas'
import { puedeConfirmarFactura } from '../../lib/ventasConfirmacion'

const linea = (cambios: Partial<LineaComprobante> = {}): LineaComprobante => ({
  id: 'l-1', orden: 1, producto_id: 'p-1', descripcion: 'Joystick', codigo: 'JOY-1', cantidad: 3, precio_unitario: 800,
  escala: 'x1', precio_manual: false, alicuota_porcentaje: 21, deposito_id: 'd-1', deposito: 'Principal', a_pedido: false,
  stock: 10, reservado: 0, subtotal_sin_iva: 2400, iva: 504, ...cambios,
})

const comprobante = (cambios: Partial<Comprobante> = {}): Comprobante => ({
  id: 'k-1', tipo: 'factura', numero: '00000001', estado: 'borrador', empresa_id: 'e-1', empresa: 'San Javucho',
  cliente: { id: 'c-1', nombre: 'Ana Pérez', documento: null, direccion: null, tipo: 'minorista', es_consumidor_final: false },
  canal: 'mostrador', fecha: '2026-10-24', valido_hasta: null, operador_id: 'u-1', operador: 'Lucía', forma_pago_id: null,
  envio_id: null, lineas: [linea()], total_sin_iva: 2400, iva: 504, total_con_iva: 2904, editable: true, puede_editar: true,
  puede_editar_precio: true, updated_at: '2026-10-24T10:00:00Z', ...cambios,
})

const abrir = (c: Comprobante = comprobante()) => {
  const onCerrar = vi.fn()
  const onConfirmado = vi.fn()
  const onRepreciado = vi.fn()
  render(
    <ConfirmarFacturaDialog
      open
      comprobante={c}
      onCerrar={onCerrar}
      onConfirmado={onConfirmado}
      onRepreciado={onRepreciado}
    />,
  )
  return { onCerrar, onConfirmado, onRepreciado }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('ConfirmarFacturaDialog (F-VTA-07)', () => {
  it('pide confirmación antes de ejecutar y no llama a la base hasta confirmar', () => {
    abrir()
    expect(screen.getByRole('dialog', { name: /Confirmar factura 00000001/ })).toBeInTheDocument()
    expect(screen.getByText(/descuenta del stock cada producto en el depósito elegido/)).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('confirma con la RPC y avisa a la pantalla', async () => {
    mocks.rpc.mockResolvedValue({ data: {}, error: null })
    const { onConfirmado } = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(onConfirmado).toHaveBeenCalledTimes(1))
    expect(mocks.rpc).toHaveBeenCalledWith('confirmar_comprobante', { p_id: 'k-1' })
  })

  it('muestra el error de stock con producto y depósito y no cierra ni confirma', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', hint: 'stock', message: 'No hay stock suficiente de Joystick en el depósito Principal: hay 2 y la factura pide 3' },
    })
    const { onConfirmado, onCerrar } = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Joystick en el depósito Principal: hay 2 y la factura pide 3')
    expect(screen.getByRole('alert')).toHaveTextContent('No se descontó nada')
    expect(onConfirmado).not.toHaveBeenCalled()
    expect(onCerrar).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeEnabled()
  })

  it('un error inesperado muestra un mensaje claro sin datos técnicos', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'relation dominio.x does not exist' } })
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos confirmar la factura. No se descontó nada')
    expect(screen.queryByText(/relation/)).not.toBeInTheDocument()
  })

  it('con un faltante visible lista la línea y no ofrece confirmar', () => {
    abrir(comprobante({ lineas: [linea({ cantidad: 12, stock: 10, reservado: 3 })] }))
    expect(screen.getByText(/Joystick en Principal: hay 7 y la línea pide 12/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled()
  })

  it('menciona las reservas solo si hay productos «A pedido»', () => {
    abrir(comprobante({ lineas: [linea(), linea({ id: 'l-2', orden: 2, a_pedido: true })] }))
    expect(screen.getByText(/reserva los productos «A pedido»/)).toBeInTheDocument()
  })

  it('Cancelar cierra sin llamar a la base', () => {
    const { onCerrar } = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCerrar).toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('MSF-816 (FR-018): si cambiaron los precios, reprecia, avisa y no reintenta la confirmación', async () => {
    mocks.rpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'confirmar_comprobante') {
        return { data: null, error: { code: '40001', hint: 'precios_cambiaron', message: 'Los precios de la venta cambiaron' } }
      }
      if (nombre === 'guardar_lineas_comprobante') return { data: null, error: null }
      return { data: comprobante({ lineas: [linea({ precio_unitario: 800, precio_referencia: 1000 })] }), error: null }
    })
    const { onConfirmado, onRepreciado } = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(await screen.findByText(/Los precios cambiaron: revisá el total y cobrá de nuevo/)).toBeInTheDocument()
    // Se re-guardan las líneas con las mismas cantidades y los mismos precios manuales.
    expect(mocks.rpc).toHaveBeenCalledWith('guardar_lineas_comprobante', {
      p_id: 'k-1',
      p_lineas: [{ producto_id: 'p-1', cantidad: 3, deposito_id: 'd-1', precio_manual: null }],
      p_actualizado_en: '2026-10-24T10:00:00Z',
    })
    expect(onRepreciado).toHaveBeenCalledTimes(1)
    // El cobro no se reintenta solo: la persona vuelve a confirmar.
    expect(onConfirmado).not.toHaveBeenCalled()
    expect(mocks.rpc.mock.calls.filter(([nombre]) => nombre === 'confirmar_comprobante')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeEnabled()
  })
})

describe('puedeConfirmarFactura', () => {
  it('solo una factura en borrador, editable y con líneas', () => {
    expect(puedeConfirmarFactura(comprobante())).toBe(true)
    expect(puedeConfirmarFactura(comprobante({ tipo: 'presupuesto', estado: 'pendiente' }))).toBe(false)
    expect(puedeConfirmarFactura(comprobante({ estado: 'confirmada', editable: false }))).toBe(false)
    expect(puedeConfirmarFactura(comprobante({ lineas: [] }))).toBe(false)
    expect(puedeConfirmarFactura(comprobante({ puede_editar: false }))).toBe(false)
  })
})
