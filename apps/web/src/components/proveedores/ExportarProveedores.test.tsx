import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ exportar: vi.fn(), descargar: vi.fn() }))
vi.mock('../../lib/exportarProveedores', async (original) => ({
  ...(await original<typeof import('../../lib/exportarProveedores')>()),
  exportarProveedores: mocks.exportar,
}))
vi.mock('../../lib/exportarClientes', async (original) => ({
  ...(await original<typeof import('../../lib/exportarClientes')>()),
  descargarArchivo: mocks.descargar,
}))

import { ExportacionCancelada } from '../../lib/exportarClientes'
import { ExportarProveedores } from './ExportarProveedores'

const filtros = { texto: 'norte', estado: 'todos' as const, empresaId: 'e-1' }
const abrir = () => render(<ExportarProveedores filtros={filtros} total={42} />)

describe('ExportarProveedores', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('pide confirmación con el total antes de exportar', () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }))
    expect(screen.getByText(/con 42 proveedores/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(mocks.exportar).not.toHaveBeenCalled()
  })

  it('exporta con los filtros actuales y descarga proveedores-AAAA-MM-DD.xlsx', async () => {
    mocks.exportar.mockImplementation(async (_f, { alProgresar }) => {
      alProgresar({ descargados: 10, total: 42 })
      return new Blob(['x'])
    })
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Descargar archivo' }))
    expect(mocks.exportar.mock.calls[0][0]).toEqual(filtros)
    expect(await screen.findByText(/el archivo se descargó/)).toBeInTheDocument()
    expect(mocks.descargar.mock.calls[0][1]).toMatch(/^proveedores-\d{4}-\d{2}-\d{2}\.xlsx$/)
  })

  it('muestra el progreso y permite cancelar sin descargar', async () => {
    mocks.exportar.mockImplementation((_f, { alProgresar, signal }) => new Promise((_ok, fallar) => {
      alProgresar({ descargados: 10, total: 42 })
      signal.addEventListener('abort', () => fallar(new ExportacionCancelada()))
    }))
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Descargar archivo' }))
    expect(await screen.findByText(/Exportando 10 de 42 proveedores/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar exportación' }))
    await waitFor(() => expect(screen.queryByText(/Exportando/)).not.toBeInTheDocument())
    expect(mocks.descargar).not.toHaveBeenCalled()
  })

  it('ante un error lo informa y permite reintentar', async () => {
    mocks.exportar.mockRejectedValueOnce(new Error('se cayó la red')).mockResolvedValueOnce(new Blob(['x']))
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Descargar archivo' }))
    expect(await screen.findByText('se cayó la red')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText(/el archivo se descargó/)).toBeInTheDocument()
  })
})
