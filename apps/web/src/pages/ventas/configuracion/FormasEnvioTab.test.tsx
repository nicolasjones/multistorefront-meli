import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), returns: vi.fn() }))

// schema('dominio').from('formas_envio').select().eq().order().order().returns()
vi.mock('../../../lib/supabase', () => {
  const cadena: Record<string, unknown> = {}
  for (const metodo of ['schema', 'from', 'select', 'eq', 'order']) cadena[metodo] = () => cadena
  cadena.returns = mocks.returns
  return { supabaseClient: { ...cadena, rpc: mocks.rpc } }
})

import { FormasEnvioTab } from './FormasEnvioTab'
import type { FormaEnvio } from '../../../lib/ventas/formasEnvio'

const SAN_JAVUCHO = { id: 'e-sj', nombre: 'San Javucho' }
const MUNDO_JC = { id: 'e-mjc', nombre: 'Mundo JC' }

const forma = (n: number, extra: Partial<FormaEnvio> = {}): FormaEnvio => ({
  id: `fe-${n}`, empresa_id: 'e-sj', nombre: `Envío ${n}`, tipo: 'correo', exige_transporte_guia: false, costo_defecto: null,
  estado_despacho_inicial: 'sin_armar', orden: n, activo: true, updated_at: '2026-10-20T10:00:00+00:00', ...extra,
})

const abrir = (puedeEditar = true) =>
  render(<FormasEnvioTab empresa={SAN_JAVUCHO} empresas={[SAN_JAVUCHO, MUNDO_JC]} puedeEditar={puedeEditar} />)

describe('FormasEnvioTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.returns.mockResolvedValue({
      data: [
        forma(1, { nombre: 'Retiro en local' }),
        forma(2, { nombre: 'Moto propia', costo_defecto: 3500 }),
        forma(3, { nombre: 'Expreso', exige_transporte_guia: true, activo: false }),
      ],
      error: null,
    })
  })

  it('muestra la ayuda y la tabla con Orden, Forma de envío, Requiere transporte y guía, Costo por defecto y Activo', async () => {
    abrir()
    expect(await screen.findByText('Moto propia')).toBeInTheDocument()
    expect(screen.getByText(/Cómo sale el pedido/)).toBeInTheDocument()
    for (const encabezado of ['Orden', 'Forma de envío', 'Requiere transporte y guía', 'Costo por defecto', 'Activo']) {
      expect(screen.getByRole('columnheader', { name: encabezado })).toBeInTheDocument()
    }
    expect(screen.queryByText('fe-1')).not.toBeInTheDocument()
  })

  it('el costo sin valor muestra «—» y con valor el importe en pesos', async () => {
    abrir()
    const retiro = (await screen.findByText('Retiro en local')).closest('tr') as HTMLElement
    expect(within(retiro).getByText('—')).toBeInTheDocument()
    const moto = screen.getByText('Moto propia').closest('tr') as HTMLElement
    expect(within(moto).getByText('$ 3.500,00')).toBeInTheDocument()
  })

  it('marca con chips Sí/No lo que requiere transporte y guía', async () => {
    abrir()
    const expreso = (await screen.findByText('Expreso')).closest('tr') as HTMLElement
    // Orden, nombre, transporte, costo, activo, acciones
    expect(within(within(expreso).getAllByRole('cell')[2]).getByText('Sí')).toBeInTheDocument()
    const retiro = screen.getByText('Retiro en local').closest('tr') as HTMLElement
    expect(within(within(retiro).getAllByRole('cell')[2]).getByText('No')).toBeInTheDocument()
  })

  it('la forma inactiva se ve atenuada y su interruptor está apagado', async () => {
    abrir()
    await screen.findByText('Expreso')
    expect(getComputedStyle(screen.getByText('Expreso')).color).not.toBe(getComputedStyle(screen.getByText('Moto propia')).color)
    expect(screen.getByRole('checkbox', { name: 'Activo: Expreso' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Activo: Moto propia' })).toBeChecked()
  })

  it('el interruptor reactiva la forma sin perder datos', async () => {
    mocks.rpc.mockResolvedValue({ data: forma(3, { nombre: 'Expreso', exige_transporte_guia: true, activo: true }), error: null })
    abrir()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Activo: Expreso' }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Activo: Expreso' })).toBeChecked())
    expect(mocks.rpc).toHaveBeenCalledWith('cambiar_estado_forma_envio', { p_id: 'fe-3', p_activo: true })
  })

  it('si el interruptor falla, avisa con un mensaje claro y deja el estado anterior', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied for table formas_envio' } })
    abrir()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Activo: Moto propia' }))
    expect(await screen.findByText(/No tenés permiso para esta acción/)).toBeInTheDocument()
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Activo: Moto propia' })).toBeChecked()
  })

  it('«Nueva forma de envío» abre el diálogo y, al crear, recarga la lista y avisa «Creado · …»', async () => {
    mocks.rpc.mockResolvedValue({ data: [forma(4, { nombre: 'Terminal' })], error: null })
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva forma de envío' }))
    const dialogo = screen.getByRole('dialog', { name: 'Nueva forma de envío' })
    expect(within(dialogo).getByRole('textbox', { name: 'Orden' })).toHaveValue('4')
    fireEvent.change(within(dialogo).getByRole('textbox', { name: /Nombre/ }), { target: { value: 'Terminal' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Crear' }))

    expect(await screen.findByText('Creado · Terminal')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.returns).toHaveBeenCalledTimes(2)
  })

  it('editar abre el diálogo con la forma elegida', async () => {
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Editar Moto propia' }))
    expect(screen.getByRole('dialog', { name: 'Editar forma de envío' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Nombre/ })).toHaveValue('Moto propia')
  })

  it('sin edición se ve la lista sin Nueva, Editar ni interruptor', async () => {
    abrir(false)
    expect(await screen.findByText('Moto propia')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nueva forma de envío' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Editar / })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('sin formas muestra el estado vacío con la empresa', async () => {
    mocks.returns.mockResolvedValue({ data: [], error: null })
    abrir()
    expect(await screen.findByText('San Javucho todavía no tiene formas de envío.')).toBeInTheDocument()
  })

  it('si falla la carga muestra el error con «Reintentar» y vuelve a cargar', async () => {
    mocks.returns.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'boom' } })
    abrir()
    expect(await screen.findByText('No pudimos cargar las formas de envío.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Moto propia')).toBeInTheDocument()
    expect(mocks.returns).toHaveBeenCalledTimes(2)
  })
})
