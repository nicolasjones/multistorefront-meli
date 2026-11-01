import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  empresas: vi.fn(),
  buscar: vi.fn(),
  agregar: vi.fn(),
  consumidor: vi.fn(),
  formas: vi.fn(),
  puede: vi.fn(),
  confirmar: vi.fn(),
  cobro: vi.fn(),
}))

vi.mock('../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: mocks.empresas }))
vi.mock('../../hooks/useListarCuentasCobro', () => ({ useListarCuentasCobro: () => ({ cuentas: [] }) }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../lib/ventas/formasPago', () => ({ listarFormasPago: mocks.formas }))
vi.mock('../../lib/ventasConfirmacion', async (original) => ({
  ...(await original<typeof import('../../lib/ventasConfirmacion')>()),
  confirmarComprobante: mocks.confirmar,
}))
vi.mock('../../lib/ventas/cobros', async (original) => ({
  ...(await original<typeof import('../../lib/ventas/cobros')>()),
  puedeRegistrarCobro: mocks.puede,
  registrarCobro: mocks.cobro,
}))
vi.mock('../../lib/ventasMostrador', async (original) => ({
  ...(await original<typeof import('../../lib/ventasMostrador')>()),
  buscarProductoPorCodigoBarras: mocks.buscar,
  agregarProductoAVenta: mocks.agregar,
  obtenerConsumidorFinal: mocks.consumidor,
}))

import { VentaMostrador } from './mostrador'

const CODIGO = '7790001000011'
const venta = (empresaId = 'e-1') => ({
  id: 'c-1', numero: '00000001', empresa_id: empresaId, empresa: 'Tienda Uno', total_con_iva: 1210, updated_at: 't',
  lineas: [{ id: 'l-1', descripcion: 'Joystick', codigo: 'JOY', cantidad: 2, precio_unitario: 500, escala: 'x1', precio_manual: false, subtotal_sin_iva: 1000, iva: 210 }],
})
const empresasDe = (activa: string | null) => ({
  empresas: [{ id: 'e-1', nombre: 'Tienda Uno' }, { id: 'e-2', nombre: 'Tienda Dos' }],
  empresaActivaId: activa, isLoading: false, isError: false, refetch: vi.fn(),
})

async function escanear(codigo: string) {
  const campo = screen.getByLabelText('Código de barras')
  fireEvent.change(campo, { target: { value: codigo } })
  fireEvent.submit(campo.closest('form') as HTMLFormElement)
}

describe('VentaMostrador (F-VTA-31, CA-VTA-31-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.empresas.mockReturnValue(empresasDe('e-1'))
    mocks.consumidor.mockResolvedValue('cf-1')
    mocks.formas.mockResolvedValue([{ id: 'f-1', nombre: 'Efectivo', activo: true, exige_cuenta_cobro: false }])
    mocks.puede.mockResolvedValue(true)
  })

  it('un código inexistente muestra «Producto no encontrado» y no crea la venta', async () => {
    mocks.buscar.mockResolvedValue(null)
    render(<VentaMostrador />)
    await escanear('7790000000000')
    expect(await screen.findByText('Producto no encontrado')).toBeTruthy()
    expect(mocks.agregar).not.toHaveBeenCalled()
  })

  it('un código que no es EAN-13 se rechaza sin llamar a la base', async () => {
    render(<VentaMostrador />)
    await escanear('123')
    expect(await screen.findByText(/13 dígitos/)).toBeTruthy()
    expect(mocks.buscar).not.toHaveBeenCalled()
  })

  it('escanear agrega la línea con Consumidor final y muestra el total', async () => {
    mocks.buscar.mockResolvedValue({ producto_id: 'p-1', nombre: 'Joystick', sku: 'JOY', codigo_barras: CODIGO })
    mocks.agregar.mockResolvedValue(venta())
    render(<VentaMostrador />)
    await escanear(CODIGO)
    expect(await screen.findByText('Joystick')).toBeTruthy()
    expect(mocks.agregar).toHaveBeenCalledWith(null, 'e-1', 'cf-1', 'p-1')
    expect(screen.getByText(/Total:/).textContent).toMatch(/1\.210/)
  })

  it('«Cobrar» confirma la factura y registra el cobro por el total', async () => {
    mocks.buscar.mockResolvedValue({ producto_id: 'p-1', nombre: 'Joystick', sku: 'JOY', codigo_barras: CODIGO })
    mocks.agregar.mockResolvedValue(venta())
    mocks.confirmar.mockResolvedValue(undefined)
    mocks.cobro.mockResolvedValue({})
    render(<VentaMostrador />)
    await escanear(CODIGO)
    const boton = await screen.findByRole('button', { name: 'Cobrar' })
    await waitFor(() => expect((boton as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(boton)
    expect(await screen.findByText(/Venta cobrada/)).toBeTruthy()
    expect(mocks.confirmar).toHaveBeenCalledWith('c-1')
    expect(mocks.cobro).toHaveBeenCalledWith('c-1', { forma_pago_id: 'f-1', cuenta_cobro_id: '', importe: '1210' })
  })

  it('si el cobro falla tras confirmar, el reintento no vuelve a confirmar', async () => {
    mocks.buscar.mockResolvedValue({ producto_id: 'p-1', nombre: 'Joystick', sku: 'JOY', codigo_barras: CODIGO })
    mocks.agregar.mockResolvedValue(venta())
    mocks.confirmar.mockResolvedValue(undefined)
    mocks.cobro.mockRejectedValueOnce({ code: 'XX000' }).mockResolvedValueOnce({})
    render(<VentaMostrador />)
    await escanear(CODIGO)
    const boton = await screen.findByRole('button', { name: 'Cobrar' })
    await waitFor(() => expect((boton as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(boton)
    expect(await screen.findByText(/no pudimos registrar el cobro/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cobrar' }))
    expect(await screen.findByText(/Venta cobrada/)).toBeTruthy()
    expect(mocks.confirmar).toHaveBeenCalledTimes(1)
  })

  it('al cambiar de empresa se descarta la venta en curso con aviso', async () => {
    mocks.buscar.mockResolvedValue({ producto_id: 'p-1', nombre: 'Joystick', sku: 'JOY', codigo_barras: CODIGO })
    mocks.agregar.mockResolvedValue(venta('e-1'))
    const { rerender } = render(<VentaMostrador />)
    await escanear(CODIGO)
    await screen.findByText('Joystick')
    mocks.empresas.mockReturnValue(empresasDe('e-2'))
    rerender(<VentaMostrador />)
    expect(await screen.findByText(/se descartó la venta en curso/)).toBeTruthy()
    expect(screen.queryByText('Joystick')).toBeNull()
  })

  it('sin una tienda concreta («Todas») pide elegir una', () => {
    mocks.empresas.mockReturnValue(empresasDe(null))
    render(<VentaMostrador />)
    expect(screen.getByText('Elegí una tienda')).toBeTruthy()
  })
})
