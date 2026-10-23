import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ anular: vi.fn(), useAnularIngreso: vi.fn() }))
vi.mock('../../hooks/useAnularIngreso', () => ({ useAnularIngreso: mocks.useAnularIngreso }))

import { AnularIngresoDialog } from './AnularIngresoDialog'

const INGRESO = { ingreso_id: 'ingreso-1', proveedor: 'Proveedor Uno', fecha: '2026-10-20' }

const abrir = (onAnulado = vi.fn()) => render(
  <AnularIngresoDialog abierto ingreso={INGRESO} onCerrar={vi.fn()} onAnulado={onAnulado} />,
)

describe('AnularIngresoDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.useAnularIngreso.mockReturnValue({ anular: mocks.anular, enviando: false })
  })

  it('exige un motivo de al menos 3 caracteres', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Anular ingreso' }))
    expect(await screen.findByText('El motivo debe tener al menos 3 caracteres.')).toBeInTheDocument()
    expect(mocks.anular).not.toHaveBeenCalled()
  })

  it('anula con el motivo y avisa al llamador', async () => {
    mocks.anular.mockResolvedValue({ ok: true, data: { id: 'ingreso-1' } })
    const onAnulado = vi.fn()
    abrir(onAnulado)
    fireEvent.change(screen.getByLabelText('Motivo de la anulación'), { target: { value: 'Carga equivocada' } })
    fireEvent.click(screen.getByRole('button', { name: 'Anular ingreso' }))
    await waitFor(() => expect(mocks.anular).toHaveBeenCalledWith('ingreso-1', 'Carga equivocada'))
    expect(onAnulado).toHaveBeenCalledTimes(1)
  })

  it('muestra el rechazo por stock insuficiente', async () => {
    mocks.anular.mockResolvedValue({ ok: false, error: { code: '23514', message: 'No hay stock suficiente' } })
    abrir()
    fireEvent.change(screen.getByLabelText('Motivo de la anulación'), { target: { value: 'Carga equivocada' } })
    fireEvent.click(screen.getByRole('button', { name: 'Anular ingreso' }))
    expect(await screen.findByText('No hay stock suficiente para anular: parte de la mercadería ya se movió.')).toBeInTheDocument()
  })
})
