import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  obtenerVinculosGarantia: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabaseClient: {} }))
vi.mock('../../lib/reparacionGarantia', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/reparacionGarantia')>()),
  obtenerVinculosGarantia: mocks.obtenerVinculosGarantia,
}))

import { VinculosGarantia } from './VinculosGarantia'

const ORIGEN = { id: 'r-1', codigo: 'R-0001' }
const REINGRESO = { id: 'r-2', codigo: 'R-0002', estado: 'Recibido', ingreso: '2026-10-28' }

function montar(reparacionId = 'r-1') {
  return render(
    <MemoryRouter>
      <VinculosGarantia reparacionId={reparacionId} />
    </MemoryRouter>,
  )
}

describe('VinculosGarantia (FR-023)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('en la nueva reparación muestra «Reingreso por garantía de R-xxxx» con enlace a la original', async () => {
    mocks.obtenerVinculosGarantia.mockResolvedValue({ origen: ORIGEN, reingresos: [] })
    montar('r-2')
    const enlace = await screen.findByRole('link', { name: 'R-0001' })
    expect(enlace).toHaveAttribute('href', '/service-tecnico/reparaciones/r-1')
    expect(screen.getByText(/Reingreso por garantía de/)).toBeInTheDocument()
  })

  it('en la original lista sus reingresos con código, estado e ingreso, y enlaza a cada uno', async () => {
    mocks.obtenerVinculosGarantia.mockResolvedValue({ origen: null, reingresos: [REINGRESO] })
    montar('r-1')
    const enlace = await screen.findByRole('link', { name: 'R-0002' })
    expect(enlace).toHaveAttribute('href', '/service-tecnico/reparaciones/r-2')
    const lista = screen.getByRole('list', { name: 'Reingresos por garantía' })
    expect(within(lista).getByText('R-0002')).toBeInTheDocument()
    expect(lista).toHaveTextContent('Recibido')
    expect(lista).toHaveTextContent('Ingreso')
  })

  it('una reparación sin vínculos no ocupa lugar', async () => {
    mocks.obtenerVinculosGarantia.mockResolvedValue({ origen: null, reingresos: [] })
    const { container } = montar('r-1')
    await vi.waitFor(() => expect(mocks.obtenerVinculosGarantia).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('si la carga falla, avisa con «Reintentar» y reintenta', async () => {
    mocks.obtenerVinculosGarantia.mockRejectedValueOnce(new Error('falla'))
    montar('r-1')
    expect(await screen.findByText('No pudimos cargar los vínculos de garantía.')).toBeInTheDocument()
    mocks.obtenerVinculosGarantia.mockResolvedValue({ origen: ORIGEN, reingresos: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('link', { name: 'R-0001' })).toBeInTheDocument()
    expect(mocks.obtenerVinculosGarantia).toHaveBeenCalledTimes(2)
  })

  it('pide los vínculos de la reparación que se le pasa', async () => {
    mocks.obtenerVinculosGarantia.mockResolvedValue({ origen: null, reingresos: [] })
    montar('r-9')
    await vi.waitFor(() => expect(mocks.obtenerVinculosGarantia).toHaveBeenCalledWith('r-9'))
  })
})
