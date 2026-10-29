import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ useComprasCliente: vi.fn(), refetch: vi.fn() }))

vi.mock('../../hooks/useComprasCliente', () => ({ useComprasCliente: mocks.useComprasCliente }))

import type { CompraCliente } from '../../hooks/useComprasCliente'
import { ComprasCliente } from './ComprasCliente'

const compra = (n: number, extra: Partial<CompraCliente> = {}): CompraCliente => ({
  numero: `0001-0000000${n}`, fecha: '2026-10-15', tipo: 'factura', estado: 'emitida', total_sin_iva: 1234567, ...extra,
})

const respuesta = (compras: CompraCliente[], extra: Record<string, unknown> = {}) => ({
  compras, total: compras.length, facturadoAnio: 4000, isLoading: false, isFetching: false, isError: false, refetch: mocks.refetch, ...extra,
})

const abrir = () => render(<ComprasCliente clienteId="c-1" />)

describe('ComprasCliente', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useComprasCliente.mockReturnValue(respuesta([compra(1), compra(2, { tipo: 'presupuesto', estado: 'anulada', total_sin_iva: 500 })]))
  })

  it('muestra el resumen comercial con el total del año y el listado en formato argentino', () => {
    abrir()
    expect(screen.getByRole('heading', { name: 'Compras' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Resumen comercial' })).toBeInTheDocument()
    expect(screen.getByText('$ 4.000')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Últimos comprobantes' })).toBeInTheDocument()
    for (const encabezado of ['Comprobante', 'Fecha', 'Estado', 'Total (sin IVA)']) {
      expect(screen.getByRole('columnheader', { name: encabezado })).toBeInTheDocument()
    }
    expect(screen.getByText('Factura 0001-00000001')).toBeInTheDocument()
    expect(screen.getAllByText('15/10/2026')).toHaveLength(2)
    expect(screen.getByText('$ 1.234.567')).toBeInTheDocument()
  })

  it('muestra el estado de anuladas y presupuestos y los números como texto (sin enlaces)', () => {
    abrir()
    expect(screen.getByText('Anulada')).toBeInTheDocument()
    expect(screen.getByText('Presupuesto 0001-00000002')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('pide la primera página de 10 y pagina en el servidor', () => {
    mocks.useComprasCliente.mockReturnValue(respuesta([compra(1)], { total: 25 }))
    abrir()
    expect(mocks.useComprasCliente).toHaveBeenLastCalledWith('c-1', 1, 10)
    expect(screen.getByText('1–10 de 25')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente/i }))
    expect(mocks.useComprasCliente).toHaveBeenLastCalledWith('c-1', 2, 10)
  })

  it('si la página pedida quedó vacía pero hay comprobantes, vuelve a la primera', () => {
    mocks.useComprasCliente.mockReturnValue(respuesta([compra(1)], { total: 25 }))
    const { rerender } = abrir()
    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente/i }))
    expect(mocks.useComprasCliente).toHaveBeenLastCalledWith('c-1', 2, 10)
    mocks.useComprasCliente.mockReturnValue(respuesta([], { total: 5 }))
    rerender(<ComprasCliente clienteId="c-1" />)
    expect(mocks.useComprasCliente).toHaveBeenLastCalledWith('c-1', 1, 10)
  })

  it('sin compras muestra el vacío y $ 0', () => {
    mocks.useComprasCliente.mockReturnValue(respuesta([], { facturadoAnio: 0 }))
    abrir()
    expect(screen.getByText('Este cliente todavía no tiene compras.')).toBeInTheDocument()
    expect(screen.getByText('$ 0')).toBeInTheDocument()
  })

  it('con error muestra el estado compartido y reintenta', () => {
    mocks.useComprasCliente.mockReturnValue(respuesta([], { isError: true }))
    abrir()
    expect(screen.getByText('No pudimos cargar las compras del cliente.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(mocks.refetch).toHaveBeenCalledTimes(1)
  })

  it('mientras carga no muestra el resumen', () => {
    mocks.useComprasCliente.mockReturnValue(respuesta([], { isLoading: true }))
    abrir()
    expect(screen.queryByText('Resumen comercial')).not.toBeInTheDocument()
  })

  it('el Consumidor final se muestra igual que cualquier cliente', () => {
    render(<ComprasCliente clienteId="consumidor-final" />)
    expect(mocks.useComprasCliente).toHaveBeenLastCalledWith('consumidor-final', 1, 10)
    expect(screen.getByRole('heading', { name: 'Compras' })).toBeInTheDocument()
  })
})
