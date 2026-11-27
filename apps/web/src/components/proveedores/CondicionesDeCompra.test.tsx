import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { violacionesAxe } from '../../test/axe'
import { CondicionesDeCompra } from './CondicionesDeCompra'

const CARGADAS = { plazo_pago_dias: 30, minimo_compra: '150000.50', moneda: 'ARS', notas: 'Pago por transferencia', updated_at: '2026-11-26T10:00:00.123456+00:00' }

const abrir = (props: Partial<Parameters<typeof CondicionesDeCompra>[0]> = {}) =>
  render(<CondicionesDeCompra proveedorId="prv-1" puedeEditar {...props} />)

const responder = (obtener: unknown[], guardar: { data?: unknown; error?: unknown } = { data: '2026-11-26T11:00:00+00:00' }) =>
  mocks.rpc.mockImplementation(async (nombre: string) => {
    if (nombre === 'obtener_condiciones_compra_proveedor') return { data: obtener, error: null }
    if (nombre === 'guardar_condiciones_compra_proveedor') return { data: guardar.data ?? null, error: guardar.error ?? null }
    return { data: null, error: null }
  })

describe('CondicionesDeCompra', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    responder([CARGADAS])
  })

  it('muestra plazo, mínimo con su moneda, moneda y notas', async () => {
    abrir()
    expect(await screen.findByText('30 días')).toBeInTheDocument()
    expect(screen.getByText(/ARS 150\.000,50/)).toBeInTheDocument()
    expect(screen.getByText('Pago por transferencia')).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledWith('obtener_condiciones_compra_proveedor', { p_proveedor_id: 'prv-1' })
  })

  it('sin condiciones cargadas muestra guiones y «Contado» para el plazo 0', async () => {
    responder([])
    const { unmount } = abrir()
    await screen.findByText('Plazo de pago')
    expect(screen.getAllByText('—')).toHaveLength(4)
    unmount()
    responder([{ ...CARGADAS, plazo_pago_dias: 0 }])
    abrir()
    expect(await screen.findByText('Contado')).toBeInTheDocument()
  })

  it('sin permiso de edición oculta «Editar condiciones»', async () => {
    abrir({ puedeEditar: false })
    await screen.findByText('30 días')
    expect(screen.queryByRole('button', { name: 'Editar condiciones' })).not.toBeInTheDocument()
  })

  it('un error de carga ofrece reintentar', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } })
    abrir()
    expect(await screen.findByText('No pudimos cargar las condiciones de compra.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Editar condiciones' })).not.toBeInTheDocument()
    mocks.rpc.mockResolvedValueOnce({ data: [CARGADAS], error: null })
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('30 días')).toBeInTheDocument()
  })

  it('edita y guarda con la marca de concurrencia, recarga y avisa', async () => {
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Editar condiciones' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Editar condiciones de compra' })
    expect(within(dialogo).getByLabelText('Plazo de pago (días)')).toHaveValue('30')
    fireEvent.change(within(dialogo).getByLabelText('Plazo de pago (días)'), { target: { value: '45' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar condiciones' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('guardar_condiciones_compra_proveedor', {
      p_proveedor_id: 'prv-1', p_plazo_pago_dias: 45, p_minimo_compra: 150000.5, p_moneda: 'ARS', p_notas: 'Pago por transferencia',
      p_actualizado: '2026-11-26T10:00:00.123456+00:00',
    }))
    expect(await screen.findByText('Condiciones de compra guardadas')).toBeInTheDocument()
    expect(mocks.rpc.mock.calls.filter(([nombre]) => nombre === 'obtener_condiciones_compra_proveedor')).toHaveLength(2)
  })

  it('valida antes de enviar: plazo fuera de rango y mínimo sin moneda', async () => {
    responder([])
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Editar condiciones' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Editar condiciones de compra' })
    fireEvent.change(within(dialogo).getByLabelText('Plazo de pago (días)'), { target: { value: '366' } })
    fireEvent.change(within(dialogo).getByLabelText('Mínimo de compra'), { target: { value: '100' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar condiciones' }))
    expect(await within(dialogo).findByText('Ingresá los días de plazo, de 0 a 365.')).toBeInTheDocument()
    expect(within(dialogo).getByText('Elegí la moneda del mínimo de compra.')).toBeInTheDocument()
    expect(mocks.rpc.mock.calls.some(([nombre]) => nombre === 'guardar_condiciones_compra_proveedor')).toBe(false)
  })

  it('un conflicto (PT412) explica y ofrece recargar las condiciones', async () => {
    responder([CARGADAS], { error: { code: 'PT412', message: 'texto interno' } })
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Editar condiciones' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Editar condiciones de compra' })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar condiciones' }))
    expect(await within(dialogo).findByText(/Otra persona modificó las condiciones/)).toBeInTheDocument()
    expect(within(dialogo).queryByText('texto interno')).not.toBeInTheDocument()
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Recargar condiciones' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('otro error del servidor se muestra sin el texto crudo y el diálogo sigue abierto', async () => {
    responder([CARGADAS], { error: { code: 'XX000', message: 'texto interno' } })
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Editar condiciones' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Editar condiciones de compra' })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar condiciones' }))
    expect(await within(dialogo).findByText('No pudimos guardar las condiciones. Intentá de nuevo.')).toBeInTheDocument()
    expect(within(dialogo).queryByText('texto interno')).not.toBeInTheDocument()
    expect(within(dialogo).queryByRole('button', { name: 'Recargar condiciones' })).not.toBeInTheDocument()
  })

  it.each([320, 768, 1440])('sin violaciones de axe a %i px (sección y diálogo abierto)', async (ancho) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: ancho })
    abrir()
    await screen.findByText('30 días')
    expect(await violacionesAxe(document.body)).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Editar condiciones' }))
    await screen.findByRole('dialog', { name: 'Editar condiciones de compra' })
    expect(await violacionesAxe(document.body)).toEqual([])
  })
})
