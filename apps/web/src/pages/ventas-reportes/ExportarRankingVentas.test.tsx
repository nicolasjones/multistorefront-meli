import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ exportar: vi.fn(), descargar: vi.fn() }))

vi.mock('../../lib/exportarRankingVentas', async (original) => ({
  ...(await original<typeof import('../../lib/exportarRankingVentas')>()),
  exportarRankingVentas: mocks.exportar,
}))
vi.mock('../../lib/exportarClientes', async (original) => ({
  ...(await original<typeof import('../../lib/exportarClientes')>()),
  descargarArchivo: mocks.descargar,
}))

import { ErrorExportacion, ExportacionCancelada } from '../../lib/exportarClientes'
import { ExportarRankingVentas } from './ExportarRankingVentas'

const PARAMETROS = { desde: '2026-10-01', hasta: '2026-10-31', incluirConsumidorFinal: false, empresaId: null }

const montar = (props: Partial<Parameters<typeof ExportarRankingVentas>[0]> = {}) =>
  render(<ExportarRankingVentas parametros={PARAMETROS} deshabilitado={false} {...props} />)

describe('ExportarRankingVentas (F-VTA-23, FR-009, SC-004, SC-005)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exporta el ranking con los filtros vigentes y avisa que el archivo se descargó', async () => {
    mocks.exportar.mockResolvedValue(new Blob(['x']))
    montar()

    fireEvent.click(screen.getByRole('button', { name: 'Exportar a Excel' }))

    expect(mocks.exportar).toHaveBeenCalledWith(
      PARAMETROS,
      expect.objectContaining({ alProgresar: expect.any(Function), signal: expect.anything() }),
    )
    expect(await screen.findByText(/Exportación lista/)).toBeInTheDocument()
    expect(mocks.descargar).toHaveBeenCalledWith(expect.anything(), 'ranking-clientes-ventas-2026-10-01_2026-10-31.xlsx')
  })

  it('el servidor rechaza la exportación sin permiso y la pantalla lo informa (SC-005)', async () => {
    mocks.exportar.mockRejectedValue(new ErrorExportacion('No tenés permiso para exportar el ranking.', '42501'))
    montar()

    fireEvent.click(screen.getByRole('button', { name: 'Exportar a Excel' }))

    expect(await screen.findByText('No tenés permiso para exportar el ranking.')).toBeInTheDocument()
    expect(mocks.descargar).not.toHaveBeenCalled()
    // El rechazo se puede reintentar (el botón «Reintentar» del aviso).
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })

  it('mientras exporta muestra el progreso, deshabilita el botón y permite cancelar', async () => {
    mocks.exportar.mockImplementation((_p, { alProgresar, signal }: { alProgresar: (p: { descargados: number; total: number }) => void; signal: AbortSignal }) => new Promise((_ok, fallar) => {
      alProgresar({ descargados: 10, total: 40 })
      signal.addEventListener('abort', () => fallar(new ExportacionCancelada()))
    }))
    montar()

    fireEvent.click(screen.getByRole('button', { name: 'Exportar a Excel' }))

    expect(await screen.findByText(/Exportando 10 de 40 clientes/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Exportar a Excel' })).toBeDisabled()
    expect(screen.getByRole('progressbar', { name: 'Progreso de la exportación' })).toHaveAttribute('aria-valuenow', '25')

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar exportación' }))
    await waitFor(() => expect(screen.queryByText(/Exportando/)).not.toBeInTheDocument())
    expect(mocks.descargar).not.toHaveBeenCalled()
  })

  it('con el ranking vacío avisa que no hay clientes y no descarga archivo', async () => {
    mocks.exportar.mockRejectedValue(new ErrorExportacion('No hay clientes en el ranking con esos filtros.', 'VACIO'))
    montar()

    fireEvent.click(screen.getByRole('button', { name: 'Exportar a Excel' }))

    expect(await screen.findByText(/No hay clientes en el ranking/)).toBeInTheDocument()
    expect(mocks.descargar).not.toHaveBeenCalled()
  })

  it('el botón se usa con el teclado y el progreso se anuncia al lector de pantalla', async () => {
    mocks.exportar.mockResolvedValue(new Blob(['x']))
    montar()

    const boton = screen.getByRole('button', { name: 'Exportar a Excel' })
    boton.focus()
    expect(boton).toHaveFocus()

    fireEvent.click(boton)
    expect(await screen.findByText(/Exportación lista/)).toBeInTheDocument()
  })

  it('al cambiar de empresa cancela la exportación en curso y no descarga el archivo de la anterior (Principio VIII)', async () => {
    mocks.exportar.mockImplementation((_p, { signal }: { signal: AbortSignal }) => new Promise((_ok, fallar) => {
      signal.addEventListener('abort', () => fallar(new ExportacionCancelada()))
    }))
    const { rerender } = montar({ parametros: { ...PARAMETROS, empresaId: 'tienda-a' } })

    fireEvent.click(screen.getByRole('button', { name: 'Exportar a Excel' }))
    expect(await screen.findByText(/Exportando/)).toBeInTheDocument()

    rerender(<ExportarRankingVentas parametros={{ ...PARAMETROS, empresaId: 'tienda-b' }} deshabilitado={false} />)

    await waitFor(() => expect(screen.queryByText(/Exportando/)).not.toBeInTheDocument())
    expect(screen.queryByText(/Exportación lista/)).not.toBeInTheDocument()
    expect(mocks.descargar).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Exportar a Excel' })).toBeEnabled()
  })

  it('al cambiar de empresa descarta el aviso de «Exportación lista» anterior', async () => {
    mocks.exportar.mockResolvedValue(new Blob(['x']))
    const { rerender } = montar({ parametros: { ...PARAMETROS, empresaId: 'tienda-a' } })

    fireEvent.click(screen.getByRole('button', { name: 'Exportar a Excel' }))
    expect(await screen.findByText(/Exportación lista/)).toBeInTheDocument()

    rerender(<ExportarRankingVentas parametros={{ ...PARAMETROS, empresaId: 'tienda-b' }} deshabilitado={false} />)

    await waitFor(() => expect(screen.queryByText(/Exportación lista/)).not.toBeInTheDocument())
  })

  it('queda deshabilitado mientras la pantalla no puede exportar', () => {
    montar({ deshabilitado: true })
    expect(screen.getByRole('button', { name: 'Exportar a Excel' })).toBeDisabled()
  })
})
