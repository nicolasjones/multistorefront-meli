import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ exportar: vi.fn(), descargar: vi.fn(), contar: vi.fn() }))
vi.mock('../../lib/supabase', () => ({
  supabaseClient: { from: () => ({ select: () => ({ then: (ok: (r: { count: number }) => void) => mocks.contar().then(ok) }) }) },
}))
vi.mock('../../lib/exportarProductos', async (original) => ({
  ...(await original<typeof import('../../lib/exportarProductos')>()),
  exportarProductos: mocks.exportar,
  descargarCsvProductos: mocks.descargar,
}))

import { CONSULTA_INICIAL } from '../../lib/productosListado'
import { DialogoExportarProductos } from './DialogoExportarProductos'

const abrir = (props: Partial<Parameters<typeof DialogoExportarProductos>[0]> = {}) => {
  const onCerrar = vi.fn()
  const onExportado = vi.fn()
  render(<DialogoExportarProductos consulta={{ ...CONSULTA_INICIAL, texto: 'joy' }} totalFiltrado={3} veRentabilidad={false} onCerrar={onCerrar} onExportado={onExportado} {...props} />)
  return { onCerrar, onExportado }
}

describe('DialogoExportarProductos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.contar.mockResolvedValue({ count: 196 })
  })

  it('muestra los campos, «Lo filtrado» vs «Todos» con su nota y Excel deshabilitado (FR-201…FR-203)', async () => {
    abrir()
    expect(screen.getByRole('dialog', { name: 'Exportar productos' })).toBeInTheDocument()
    expect(screen.getByText('Qué exportar')).toBeInTheDocument()
    expect(screen.getByText('Formato')).toBeInTheDocument()
    expect(screen.getByText('Columnas')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lo filtrado (3)' })).toBeInTheDocument()
    expect(screen.getByText('Respeta la búsqueda, los filtros y la categoría elegida.')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Todos (196)' }))
    expect(screen.getByText('Todo el catálogo, sin filtros.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'CSV' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Excel (.xlsx)' })).toBeDisabled()
  })

  it('ofrece Costo y Proveedor solo con Rentabilidad, y marca por defecto las ocho primeras (FR-204)', () => {
    const { unmount } = render(<DialogoExportarProductos consulta={CONSULTA_INICIAL} totalFiltrado={3} veRentabilidad={false} onCerrar={vi.fn()} onExportado={vi.fn()} />)
    expect(screen.queryByRole('checkbox', { name: 'Costo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Proveedor' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(7)
    unmount()
    render(<DialogoExportarProductos consulta={CONSULTA_INICIAL} totalFiltrado={3} veRentabilidad onCerrar={vi.fn()} onExportado={vi.fn()} />)
    expect(screen.getByRole('checkbox', { name: 'Costo' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Proveedor' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Código de barras' })).not.toBeChecked()
    expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(8)
  })

  it('exporta lo filtrado con la consulta del listado, descarga y avisa (FR-205)', async () => {
    mocks.exportar.mockResolvedValue({ csv: 'x', productos: 3, columnas: 7 })
    const { onExportado } = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }))
    await waitFor(() => expect(onExportado).toHaveBeenCalledWith(3, 7))
    expect(mocks.exportar.mock.calls[0][1].filtros).toMatchObject({ busqueda: 'joy' })
    expect(mocks.descargar).toHaveBeenCalledWith('x')
  })

  it('si el archivo se recortó al tope lo informa al padre (hallazgo 5)', async () => {
    mocks.exportar.mockResolvedValue({ csv: 'x', productos: 50000, columnas: 7, recortado: true, tope: 50000 })
    const { onExportado } = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }))
    await waitFor(() => expect(onExportado).toHaveBeenCalledWith(50000, 7, 50000))
  })

  it('«Todos» exporta sin filtros', async () => {
    mocks.exportar.mockResolvedValue({ csv: 'x', productos: 196, columnas: 7 })
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Todos (196)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }))
    await waitFor(() => expect(mocks.exportar).toHaveBeenCalled())
    expect(mocks.exportar.mock.calls[0][1].filtros).toEqual({ todos: true })
  })

  it('sin productos el botón queda deshabilitado (FR-205)', () => {
    abrir({ totalFiltrado: 0 })
    expect(screen.getByRole('button', { name: 'Exportar' })).toBeDisabled()
    expect(screen.getByText('No hay productos para exportar.')).toBeInTheDocument()
  })

  it('ante un error lo informa y permite reintentar', async () => {
    mocks.exportar.mockRejectedValueOnce(new Error('red')).mockResolvedValueOnce({ csv: 'x', productos: 3, columnas: 7 })
    const { onExportado } = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }))
    expect(await screen.findByText('No pudimos exportar los productos. Intentá de nuevo.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(onExportado).toHaveBeenCalled())
  })

  it('si falla el conteo de «Todos» lo informa y permite reintentar', async () => {
    mocks.contar.mockResolvedValueOnce({ count: null, error: new Error('rls') }).mockResolvedValueOnce({ count: 196 })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    abrir()
    expect(await screen.findByText('No pudimos contar los productos del catálogo.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Todos (196)')).toBeInTheDocument()
  })
})
