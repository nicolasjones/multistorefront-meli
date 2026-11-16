import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), returns: vi.fn() }))

// schema('dominio').from('formas_pago').select().eq().order().order().returns()
vi.mock('../../../lib/supabase', () => {
  const cadena: Record<string, unknown> = {}
  for (const metodo of ['schema', 'from', 'select', 'eq', 'order']) cadena[metodo] = () => cadena
  cadena.returns = mocks.returns
  return { supabaseClient: { ...cadena, rpc: mocks.rpc } }
})

import { FormasPagoTab } from './FormasPagoTab'
import type { FormaPago } from '../../../lib/ventas/formasPago'

const SAN_JAVUCHO = { id: 'e-sj', nombre: 'San Javucho' }
const MUNDO_JC = { id: 'e-mjc', nombre: 'Mundo JC' }

const forma = (n: number, extra: Partial<FormaPago> = {}): FormaPago => ({
  id: `fp-${n}`, empresa_id: 'e-sj', nombre: `Forma ${n}`, tipo: 'otro', exige_cuenta_cobro: false, genera_deuda: false,
  estado_inicial: 'pendiente', orden: n, activo: true, updated_at: '2026-10-20T10:00:00+00:00', ...extra,
})

const abrir = (puedeEditar = true) =>
  render(<FormasPagoTab empresa={SAN_JAVUCHO} empresas={[SAN_JAVUCHO, MUNDO_JC]} puedeEditar={puedeEditar} />)

describe('FormasPagoTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.returns.mockResolvedValue({
      data: [
        forma(1, { nombre: 'Efectivo' }),
        forma(2, { nombre: 'Transferencia o depósito bancario', exige_cuenta_cobro: true }),
        forma(3, { nombre: 'Cuenta corriente', genera_deuda: true, activo: false }),
      ],
      error: null,
    })
  })

  it('muestra la ayuda y la tabla con Orden, Forma de pago, Pide cuenta de cobro, Genera deuda y Activo', async () => {
    abrir()
    expect(await screen.findByText('Transferencia o depósito bancario')).toBeInTheDocument()
    expect(screen.getByText(/Qué formas de cobro ofrece el comprobante/)).toBeInTheDocument()
    for (const encabezado of ['Orden', 'Forma de pago', 'Pide cuenta de cobro', 'Genera deuda', 'Activo']) {
      expect(screen.getByRole('columnheader', { name: encabezado })).toBeInTheDocument()
    }
    // Sin identificadores técnicos a la vista.
    expect(screen.queryByText('fp-1')).not.toBeInTheDocument()
  })

  it('marca con chips Sí/No lo que pide cuenta de cobro y lo que genera deuda', async () => {
    abrir()
    const transferencia = (await screen.findByText('Transferencia o depósito bancario')).closest('tr') as HTMLElement
    // Orden, nombre, pide cuenta, genera deuda, activo, acciones
    const celdas = within(transferencia).getAllByRole('cell')
    expect(within(celdas[2]).getByText('Sí')).toBeInTheDocument()
    expect(within(celdas[3]).getByText('No')).toBeInTheDocument()
    const deuda = screen.getByText('Cuenta corriente').closest('tr') as HTMLElement
    expect(within(within(deuda).getAllByRole('cell')[3]).getByText('Sí')).toBeInTheDocument()
  })

  it('la forma inactiva se ve atenuada y su interruptor está apagado', async () => {
    abrir()
    await screen.findByText('Cuenta corriente')
    expect(getComputedStyle(screen.getByText('Cuenta corriente')).color).not.toBe(getComputedStyle(screen.getByText('Efectivo')).color)
    expect(screen.getByRole('checkbox', { name: 'Activo: Cuenta corriente' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Activo: Efectivo' })).toBeChecked()
  })

  it('el interruptor reactiva la forma sin perder datos', async () => {
    mocks.rpc.mockResolvedValue({ data: forma(3, { nombre: 'Cuenta corriente', genera_deuda: true, activo: true }), error: null })
    abrir()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Activo: Cuenta corriente' }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Activo: Cuenta corriente' })).toBeChecked())
    expect(mocks.rpc).toHaveBeenCalledWith('cambiar_estado_forma_pago', { p_id: 'fp-3', p_activo: true })
  })

  it('si el interruptor falla, avisa con un mensaje claro y deja el estado anterior', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied for table formas_pago' } })
    abrir()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Activo: Efectivo' }))
    expect(await screen.findByText(/No tenés permiso para esta acción/)).toBeInTheDocument()
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Activo: Efectivo' })).toBeChecked()
  })

  it('«Nueva forma de pago» abre el diálogo y, al crear, recarga la lista y avisa «Creado · …»', async () => {
    mocks.rpc.mockResolvedValue({ data: [forma(4, { nombre: 'Tarjeta' })], error: null })
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva forma de pago' }))
    const dialogo = screen.getByRole('dialog', { name: 'Nueva forma de pago' })
    expect(within(dialogo).getByRole('textbox', { name: 'Orden' })).toHaveValue('4')
    fireEvent.change(within(dialogo).getByRole('textbox', { name: /Nombre/ }), { target: { value: 'Tarjeta' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Crear' }))

    expect(await screen.findByText('Creado · Tarjeta')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Una carga inicial y otra tras crear.
    expect(mocks.returns).toHaveBeenCalledTimes(2)
  })

  it('editar abre el diálogo con la forma elegida', async () => {
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Editar Efectivo' }))
    expect(screen.getByRole('dialog', { name: 'Editar forma de pago' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Nombre/ })).toHaveValue('Efectivo')
  })

  it('sin edición se ve la lista sin Nueva, Editar ni interruptor', async () => {
    abrir(false)
    expect(await screen.findByText('Efectivo')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nueva forma de pago' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Editar / })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('sin formas muestra el estado vacío con la empresa', async () => {
    mocks.returns.mockResolvedValue({ data: [], error: null })
    abrir()
    expect(await screen.findByText('San Javucho todavía no tiene formas de pago.')).toBeInTheDocument()
    expect(screen.getByText('Creá la primera para que el comprobante la ofrezca.')).toBeInTheDocument()
  })

  it('si falla la carga muestra el error con «Reintentar» y vuelve a cargar', async () => {
    mocks.returns.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'boom' } })
    abrir()
    expect(await screen.findByText('No pudimos cargar las formas de pago.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Efectivo')).toBeInTheDocument()
    expect(mocks.returns).toHaveBeenCalledTimes(2)
  })
})
