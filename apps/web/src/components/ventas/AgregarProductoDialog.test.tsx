import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ buscarProductosConAviso: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: {} }))
vi.mock('../../lib/reparacionItems', () => ({ buscarProductosConAviso: mocks.buscarProductosConAviso }))
vi.mock('../../lib/ventasLineas', () => ({ disponibleParaVenta: vi.fn().mockResolvedValue(1) }))

import { AgregarProductoDialog } from './AgregarProductoDialog'

const producto = { id: 'p-1', nombre: 'Cámara', sku: 'CAM-1', disponibilidad_manual: null }

async function buscar() {
  render(<AgregarProductoDialog depositoPorDefecto={null} onElegir={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Agregar producto' }))
  fireEvent.change(await screen.findByLabelText('Buscar producto del catálogo'), { target: { value: 'cam' } })
  await waitFor(() => expect(mocks.buscarProductosConAviso).toHaveBeenCalledWith('cam'))
}

describe('AgregarProductoDialog · hay más resultados (MSF-722)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('avisa «Hay más resultados» cuando la búsqueda supera el tope', async () => {
    mocks.buscarProductosConAviso.mockResolvedValue({ productos: [producto], hayMas: true })
    await buscar()
    expect(await screen.findByText('Hay más resultados: afiná la búsqueda para verlos.')).toBeInTheDocument()
  })

  it('no avisa cuando entran todos los resultados', async () => {
    mocks.buscarProductosConAviso.mockResolvedValue({ productos: [producto], hayMas: false })
    await buscar()
    await screen.findByText('Nombre o SKU.')
    expect(screen.queryByText(/Hay más resultados/)).not.toBeInTheDocument()
  })
})
