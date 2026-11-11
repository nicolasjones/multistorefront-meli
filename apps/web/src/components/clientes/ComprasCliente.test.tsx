import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../test/axe'
import { celular } from '../../test/matchMedia'
import { tokens } from '../../tema/tokens'

const mocks = vi.hoisted(() => ({ useComprasCliente: vi.fn(), useCuentaCorrienteCliente: vi.fn(), refetch: vi.fn(), reintentarCuenta: vi.fn() }))

vi.mock('../../hooks/useComprasCliente', () => ({ useComprasCliente: mocks.useComprasCliente }))
vi.mock('../../hooks/useCuentaCorrienteCliente', () => ({ useCuentaCorrienteCliente: mocks.useCuentaCorrienteCliente }))

import type { CompraCliente } from '../../hooks/useComprasCliente'
import type { ComprobanteDeuda } from '../../hooks/useCuentaCorrienteCliente'
import { ComprasCliente } from './ComprasCliente'

const compra = (n: number, extra: Partial<CompraCliente> = {}): CompraCliente => ({
  numero: `0001-0000000${n}`, fecha: '2026-10-15', tipo: 'factura', estado: 'emitida', total_sin_iva: 1234567, ...extra,
})

const respuesta = (compras: CompraCliente[], extra: Record<string, unknown> = {}) => ({
  compras, total: compras.length, facturadoAnio: 4000, isLoading: false, isFetching: false, isError: false, refetch: mocks.refetch, ...extra,
})

const documento = (n: number, extra: Partial<ComprobanteDeuda> = {}): ComprobanteDeuda => ({
  id: `d-${n}`, numero: `0001-0000001${n}`, fecha: '2026-10-12', estado: 'deuda',
  total_con_iva: 1210, cobrado: 0, saldo: 1210, ...extra,
})

const respuestaCuenta = (documentos: ComprobanteDeuda[], extra: Record<string, unknown> = {}) => ({
  saldo: documentos.reduce((total, d) => total + d.saldo, 0),
  documentos, isLoading: false, isFetching: false, isError: false, refetch: mocks.reintentarCuenta, ...extra,
})

const tablaCompras = () => within(screen.getByRole('table', { name: 'Últimos comprobantes del cliente' }))
const tablaCuenta = () => within(screen.getByRole('table', { name: 'Comprobantes con saldo del cliente' }))
const abrir = () => render(<ComprasCliente clienteId="c-1" />)

describe('ComprasCliente', () => {
  const matchMediaOriginal = window.matchMedia

  beforeEach(() => {
    vi.clearAllMocks()
    window.matchMedia = matchMediaOriginal
    mocks.useComprasCliente.mockReturnValue(respuesta([compra(1), compra(2, { tipo: 'presupuesto', estado: 'anulada', total_sin_iva: 500 })]))
    mocks.useCuentaCorrienteCliente.mockReturnValue(respuestaCuenta([documento(1)]))
  })

  afterEach(() => {
    window.matchMedia = matchMediaOriginal
  })

  it('muestra el resumen comercial con el total del año y el listado en formato argentino', () => {
    abrir()
    expect(screen.getByRole('heading', { name: 'Compras' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Resumen comercial' })).toBeInTheDocument()
    expect(screen.getByText('$ 4.000')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Últimos comprobantes' })).toBeInTheDocument()
    for (const encabezado of ['Comprobante', 'Fecha', 'Estado', 'Total (sin IVA)']) {
      expect(tablaCompras().getByRole('columnheader', { name: encabezado })).toBeInTheDocument()
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

  it('muestra el saldo deudor del cliente junto al facturado', () => {
    abrir()
    const saldo = screen.getByText('Saldo deudor').parentElement!
    expect(within(saldo).getByText('$ 1.210')).toBeInTheDocument()
  })

  it('el saldo deudor se pinta como el prototipo: ámbar con deuda y verde sin deuda', () => {
    abrir()
    const saldo = screen.getByText('Saldo deudor').parentElement!
    expect(within(saldo).getByText('$ 1.210')).toHaveStyle({ color: tokens.color.etiqueta.aviso.texto })
  })

  it('sin deuda el saldo deudor se pinta en verde', () => {
    mocks.useCuentaCorrienteCliente.mockReturnValue(respuestaCuenta([]))
    abrir()
    const saldo = screen.getByText('Saldo deudor').parentElement!
    expect(within(saldo).getByText('$ 0')).toHaveStyle({ color: tokens.color.etiqueta.exito.texto })
  })

  it('la etiqueta «Deuda» va en ámbar, como en el prototipo', () => {
    abrir()
    const chip = tablaCuenta().getByText('Deuda').closest('.MuiChip-root')
    expect(chip).toHaveStyle({
      backgroundColor: tokens.color.etiqueta.aviso.fondo,
      color: tokens.color.etiqueta.aviso.texto,
    })
  })

  it('si fallan las compras, el saldo deudor igual se ve', () => {
    mocks.useComprasCliente.mockReturnValue(respuesta([], { isError: true }))
    abrir()
    expect(screen.getByText('No pudimos cargar las compras del cliente.')).toBeInTheDocument()
    const saldo = screen.getByText('Saldo deudor').parentElement!
    expect(within(saldo).getByText('$ 1.210')).toBeInTheDocument()
  })

  it('dos comprobantes con el mismo número (tiendas distintas) son filas distintas', () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.useCuentaCorrienteCliente.mockReturnValue(respuestaCuenta([
      documento(1),
      documento(1, { id: 'd-otro', total_con_iva: 500, cobrado: 0, saldo: 500 }),
    ]))
    abrir()
    expect(tablaCuenta().getAllByText('0001-00000011')).toHaveLength(2)
    expect(consola.mock.calls.flat().join(' ')).not.toMatch(/same key/i)
    consola.mockRestore()
  })

  it('muestra la cuenta corriente con los comprobantes que tienen saldo', () => {
    abrir()
    expect(screen.getByRole('heading', { name: 'Cuenta corriente' })).toBeInTheDocument()
    for (const encabezado of ['Comprobante', 'Fecha', 'Estado', 'Total', 'Cobrado', 'Saldo']) {
      expect(tablaCuenta().getByRole('columnheader', { name: encabezado })).toBeInTheDocument()
    }
    expect(tablaCuenta().getByText('0001-00000011')).toBeInTheDocument()
    expect(tablaCuenta().getByText('12/10/2026')).toBeInTheDocument()
    expect(tablaCuenta().getByText('Deuda')).toBeInTheDocument()
    expect(tablaCuenta().getAllByText('$ 1.210')).toHaveLength(2)
    expect(tablaCuenta().getByText('$ 0')).toBeInTheDocument()
  })

  it('sin comprobantes con saldo muestra el vacío y el saldo en $ 0', () => {
    mocks.useCuentaCorrienteCliente.mockReturnValue(respuestaCuenta([]))
    abrir()
    expect(screen.getByText('Este cliente no tiene comprobantes con saldo.')).toBeInTheDocument()
    expect(screen.getByText('$ 0')).toBeInTheDocument()
  })

  it('si la cuenta corriente no se puede leer, muestra el error con «Reintentar» y el saldo como «—»', () => {
    mocks.useCuentaCorrienteCliente.mockReturnValue(respuestaCuenta([], { isError: true }))
    abrir()
    expect(screen.getByText('No pudimos cargar la cuenta corriente del cliente.')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(mocks.reintentarCuenta).toHaveBeenCalledTimes(1)
  })

  it('pide la primera tanda de 10 y «Cargar más» suma la siguiente a lo ya mostrado', () => {
    const tanda1 = [compra(1)]
    const tanda2 = [compra(2)]
    mocks.useComprasCliente.mockImplementation((_id: string, pagina: number) => respuesta(pagina === 2 ? tanda2 : tanda1, { total: 2 }))
    abrir()
    expect(mocks.useComprasCliente).toHaveBeenLastCalledWith('c-1', 1, 10)
    expect(screen.getByText('Factura 0001-00000001')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
    expect(mocks.useComprasCliente).toHaveBeenLastCalledWith('c-1', 2, 10)
    expect(screen.getByText('Factura 0001-00000001')).toBeInTheDocument()
    expect(screen.getByText('Factura 0001-00000002')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /next page|siguiente/i })).not.toBeInTheDocument()
  })

  it('al cambiar de cliente vuelve a la primera tanda y descarta lo acumulado', () => {
    mocks.useComprasCliente.mockReturnValue(respuesta([compra(1)], { total: 25 }))
    const { rerender } = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
    expect(mocks.useComprasCliente).toHaveBeenLastCalledWith('c-1', 2, 10)
    rerender(<ComprasCliente clienteId="c-2" />)
    expect(mocks.useComprasCliente).toHaveBeenLastCalledWith('c-2', 1, 10)
  })

  it('sin compras muestra el vacío y $ 0', () => {
    mocks.useComprasCliente.mockReturnValue(respuesta([], { facturadoAnio: 0 }))
    abrir()
    expect(screen.getByText('Este cliente todavía no tiene compras.')).toBeInTheDocument()
    const facturado = screen.getByText('Facturado en el año (sin IVA)').parentElement!
    expect(within(facturado).getByText('$ 0')).toBeInTheDocument()
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
    expect(mocks.useCuentaCorrienteCliente).toHaveBeenLastCalledWith('consumidor-final')
    expect(screen.getByRole('heading', { name: 'Compras' })).toBeInTheDocument()
  })

  // FR-006: la sección se usa a 320 px (tarjetas), a 768 px y a 1440 px (tabla), con teclado
  // y lector de pantalla.
  it.each([320, 768, 1440])('no tiene violaciones de accesibilidad a %i px', async (ancho) => {
    celular(ancho < 600)
    const { container } = abrir()
    expect(await violacionesAxe(container)).toEqual([])
  })

  it('los importes de la cuenta corriente muestran los centavos: 1.210,50 y 0,40 no se redondean', () => {
    mocks.useCuentaCorrienteCliente.mockReturnValue(respuestaCuenta([
      documento(1, { total_con_iva: 1210.5, cobrado: 0, saldo: 1210.5 }),
      documento(2, { total_con_iva: 1000, cobrado: 999.6, saldo: 0.4 }),
    ]))
    abrir()
    expect(within(screen.getByText('Saldo deudor').parentElement as HTMLElement).getByText('$ 1.210,90')).toBeInTheDocument()
    expect(tablaCuenta().getAllByText('$ 1.210,50')).toHaveLength(2)
    expect(tablaCuenta().getByText('$ 0,40')).toBeInTheDocument()
    expect(tablaCuenta().getByText('$ 999,60')).toBeInTheDocument()
    expect(tablaCuenta().getByText('$ 1.000')).toBeInTheDocument()
  })

  it('mientras carga la cuenta corriente: el saldo deudor muestra «—» y la tabla un estado de carga', () => {
    mocks.useCuentaCorrienteCliente.mockReturnValue(respuestaCuenta([], { saldo: 0, isLoading: true, isFetching: true }))
    abrir()
    expect(within(screen.getByText('Saldo deudor').parentElement as HTMLElement).getByText('—')).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Comprobantes con saldo del cliente' })).not.toBeInTheDocument()
    expect(screen.queryByText('Este cliente no tiene comprobantes con saldo.')).not.toBeInTheDocument()
  })
})

