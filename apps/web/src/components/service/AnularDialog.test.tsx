import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ anularReparacion: vi.fn() }))

vi.mock('../../lib/supabase', () => ({ supabaseClient: {} }))
vi.mock('../../lib/reparaciones', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/reparaciones')>()),
  anularReparacion: mocks.anularReparacion,
}))

import type { ItemReparacion, Reparacion } from '../../lib/reparaciones'
import { AVISO_DEVOLUCION_ANULAR, AnularDialog } from './AnularDialog'

const item = (id: string, descripcion: string, extra: Partial<ItemReparacion> = {}): ItemReparacion => ({
  id, tipo: 'repuesto', descripcion, producto_id: 'p-1', sku: 'PAN-1', cantidad: 2, precio_unitario: 100, subtotal: 200,
  deposito_id: 'd-1', deposito_nombre: 'Depósito principal', stock_estado: 'descontado', ...extra,
})

const montar = (items: ItemReparacion[]) => {
  const onAnulada = vi.fn()
  render(
    <AnularDialog
      abierto
      reparacion={{ id: 'r-1', codigo: 'R-0001', items } as unknown as Reparacion}
      onCerrar={vi.fn()}
      onAnulada={onAnulada}
    />,
  )
  return { onAnulada }
}

const anular = () => {
  fireEvent.change(screen.getByLabelText(/Motivo de la anulación/), { target: { value: 'Cliente desistió' } })
  fireEvent.click(screen.getByRole('button', { name: 'Anular reparación' }))
}

describe('AnularDialog con repuestos descontados (F-SVC-11, FR-023)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.anularReparacion.mockResolvedValue({ id: 'r-1', codigo: 'R-0001' })
  })

  it('por defecto se devuelven todos: no manda consumidos y avisa que vuelven al stock', async () => {
    const { onAnulada } = montar([item('i-1', 'Pantalla Switch')])

    const grupo = screen.getByRole('group', { name: 'Repuestos descontados del stock' })
    expect(within(grupo).getByText(AVISO_DEVOLUCION_ANULAR)).toBeInTheDocument()
    expect(within(grupo).getByRole('checkbox', { name: /Consumido, no se devuelve/ })).not.toBeChecked()
    anular()

    await waitFor(() => expect(mocks.anularReparacion).toHaveBeenCalledWith('r-1', 'Cliente desistió', []))
    await waitFor(() => expect(onAnulada).toHaveBeenCalled())
  })

  it('«Consumido, no se devuelve» manda solo los ids marcados', async () => {
    montar([item('i-1', 'Pantalla Switch'), item('i-2', 'Bisagra')])

    fireEvent.click(screen.getByRole('checkbox', { name: /Bisagra.*Consumido, no se devuelve/ }))
    anular()

    await waitFor(() => expect(mocks.anularReparacion).toHaveBeenCalledWith('r-1', 'Cliente desistió', ['i-2']))
  })

  it('sin repuestos descontados no muestra la lista', () => {
    montar([item('i-3', 'Cinta flex', { stock_estado: 'sin_movimiento', deposito_id: null, deposito_nombre: null })])

    expect(screen.queryByRole('group', { name: 'Repuestos descontados del stock' })).not.toBeInTheDocument()
  })
})
