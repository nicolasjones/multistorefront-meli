import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { violacionesAxe } from '../../test/axe'
import { VentasPorLista } from './VentasPorLista'

const RANGO = { desde: '2026-10-01', hasta: '2026-10-31' }
const FILAS = [
  { lista_id: 'l', lista_nombre: 'Revendedores', ajuste_pct_actual: '-20.00', comprobantes: 3, unidades: 2, ventas_netas: '800.00', ajuste_otorgado: '-200.00' },
  { lista_id: null, lista_nombre: null, ajuste_pct_actual: null, comprobantes: 1, unidades: 1, ventas_netas: '500.00', ajuste_otorgado: '0.00' },
]

describe('VentasPorLista', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.rpc.mockResolvedValue({ data: FILAS, error: null })
  })

  it('muestra una fila por lista y «Sin lista» con guiones, más la nota de alcance', async () => {
    render(<VentasPorLista rango={RANGO} empresaId={null} cargandoEmpresa={false} />)
    const tabla = await screen.findByRole('table', { name: 'Ventas por lista de precios' })
    const filas = within(tabla).getAllByRole('row')
    expect(within(filas[1]).getByText('Revendedores')).toBeInTheDocument()
    expect(within(filas[1]).getByText('-20 %')).toBeInTheDocument()
    expect(within(filas[1]).getByText('$ 800')).toBeInTheDocument()
    expect(within(filas[1]).getByText('-$ 200')).toBeInTheDocument()
    expect(within(filas[2]).getByText('Sin lista')).toBeInTheDocument()
    expect(within(filas[2]).getAllByText('—')).toHaveLength(2)
    expect(screen.getByText(/El margen por lista no se calcula/)).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledWith('ventas_por_lista_precios', { p_desde: '2026-10-01', p_hasta: '2026-10-31', p_empresa_id: null })
  })

  it('no consulta mientras carga la empresa y consulta de nuevo al cambiarla, sin filas de la anterior', async () => {
    const { rerender } = render(<VentasPorLista rango={RANGO} empresaId={null} cargandoEmpresa />)
    expect(mocks.rpc).not.toHaveBeenCalled()
    rerender(<VentasPorLista rango={RANGO} empresaId="e-1" cargandoEmpresa={false} />)
    await screen.findByRole('table', { name: 'Ventas por lista de precios' })
    expect(mocks.rpc).toHaveBeenLastCalledWith('ventas_por_lista_precios', { p_desde: '2026-10-01', p_hasta: '2026-10-31', p_empresa_id: 'e-1' })
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    rerender(<VentasPorLista rango={RANGO} empresaId="e-2" cargandoEmpresa={false} />)
    expect(await screen.findByText('No hay ventas en ese período')).toBeInTheDocument()
    expect(screen.queryByText('Revendedores')).not.toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
  })

  it('un cambio de período vuelve a consultar', async () => {
    const { rerender } = render(<VentasPorLista rango={RANGO} empresaId={null} cargandoEmpresa={false} />)
    await screen.findByRole('table', { name: 'Ventas por lista de precios' })
    rerender(<VentasPorLista rango={{ desde: '2026-09-01', hasta: '2026-09-30' }} empresaId={null} cargandoEmpresa={false} />)
    await waitFor(() => expect(mocks.rpc).toHaveBeenLastCalledWith('ventas_por_lista_precios', { p_desde: '2026-09-01', p_hasta: '2026-09-30', p_empresa_id: null }))
  })

  it('sin ventas muestra el estado vacío', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    render(<VentasPorLista rango={RANGO} empresaId={null} cargandoEmpresa={false} />)
    expect(await screen.findByText('No hay ventas en ese período')).toBeInTheDocument()
  })

  it('un error muestra el mensaje en castellano y reintentar vuelve a consultar', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'texto interno' } })
    render(<VentasPorLista rango={RANGO} empresaId={null} cargandoEmpresa={false} />)
    expect(await screen.findByText('Tu rol no puede ver las ventas por lista de precios.')).toBeInTheDocument()
    expect(screen.queryByText('texto interno')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('table', { name: 'Ventas por lista de precios' })).toBeInTheDocument()
  })

  it.each([320, 768, 1440])('sin violaciones de axe a %i px', async (ancho) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: ancho })
    render(<VentasPorLista rango={RANGO} empresaId={null} cargandoEmpresa={false} />)
    await screen.findByRole('table', { name: 'Ventas por lista de precios' })
    expect(await violacionesAxe(document.body)).toEqual([])
  })
})
