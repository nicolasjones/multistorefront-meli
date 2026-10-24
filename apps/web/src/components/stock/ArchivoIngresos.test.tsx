import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  returns: vi.fn(),
  range: vi.fn(),
  puedeEscribir: true,
}))

vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    schema: () => ({
      from: () => {
        const cadena = {
          select: () => cadena,
          order: () => cadena,
          range: (...args: unknown[]) => { mocks.range(...args); return cadena },
          returns: mocks.returns,
        }
        return cadena
      },
    }),
  },
}))

vi.mock('../../hooks/usePuedeEscribir', () => ({
  usePuedeEscribir: () => ({ puedeEscribir: mocks.puedeEscribir, isLoading: false }),
}))

import { notificarEmpresaActivaCambiada } from '../../lib/empresaActivaRevision'
import { ArchivoIngresos } from './ArchivoIngresos'

const FILAS = [
  { id: 'a-1', fecha: '2025-03-14', producto: 'Producto Sintético Uno', cantidad: 12, proveedor: 'Proveedor Sintético A', operador: 'Operador Sintético 01' },
  { id: 'a-2', fecha: '2025-03-15', producto: 'Producto Sintético Dos', cantidad: 3, proveedor: null, operador: null },
]

const abrir = () => render(<MemoryRouter><ArchivoIngresos /></MemoryRouter>)

describe('ArchivoIngresos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.puedeEscribir = true
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.returns.mockResolvedValue({ data: FILAS, error: null, count: 60 })
  })

  it('lista Fecha, Producto, Cantidad, Proveedor y Operador con el aviso de solo consulta', async () => {
    abrir()
    expect(await screen.findByText('Producto Sintético Uno')).toBeInTheDocument()
    for (const encabezado of ['Fecha', 'Producto', 'Cantidad', 'Proveedor', 'Operador']) {
      expect(screen.getAllByText(encabezado).length).toBeGreaterThan(0)
    }
    expect(screen.getByText('14/03/2025')).toBeInTheDocument()
    expect(screen.getByText('+12')).toBeInTheDocument()
    expect(screen.getByText('Operador Sintético 01')).toBeInTheDocument()
    expect(screen.getByText(/Archivo de solo consulta/)).toBeInTheDocument()
    expect(screen.getByText('60 líneas')).toBeInTheDocument()
    // Solo lectura: ninguna acción de edición o borrado.
    expect(screen.queryByRole('button', { name: /editar|borrar|eliminar|anular/i })).toBeNull()
  })

  it('pagina en servidor pidiendo el rango de la página', async () => {
    abrir()
    await screen.findByText('Producto Sintético Uno')
    expect(mocks.range).toHaveBeenLastCalledWith(0, 24)
    fireEvent.click(screen.getByRole('button', { name: /siguiente|next/i }))
    await waitFor(() => expect(mocks.range).toHaveBeenLastCalledWith(25, 49))
  })

  it('muestra el estado vacío', async () => {
    mocks.returns.mockResolvedValue({ data: [], error: null, count: 0 })
    abrir()
    expect(await screen.findByText('Todavía no hay ingresos archivados.')).toBeInTheDocument()
  })

  it('muestra el error y reintenta', async () => {
    mocks.returns.mockResolvedValueOnce({ data: null, error: { message: 'falla' }, count: null })
    abrir()
    expect(await screen.findByText('No pudimos cargar el archivo de ingresos.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }))
    expect(await screen.findByText('Producto Sintético Uno')).toBeInTheDocument()
  })

  it('declara el alcance de organización y no recarga ni mezcla al cambiar de empresa', async () => {
    abrir()
    await screen.findByText('Producto Sintético Uno')
    expect(screen.getByText(/toda la\s+organización/)).toBeInTheDocument()
    const consultas = mocks.returns.mock.calls.length

    await act(async () => { notificarEmpresaActivaCambiada() })

    expect(mocks.returns.mock.calls.length).toBe(consultas)
    expect(screen.getByText('Producto Sintético Uno')).toBeInTheDocument()
  })

  it('trata una página fuera de rango (416) como vacía y vuelve a la página 1', async () => {
    abrir()
    await screen.findByText('Producto Sintético Uno')
    mocks.returns.mockResolvedValueOnce({ data: null, error: { code: 'PGRST103' }, count: null })
    fireEvent.click(screen.getByRole('button', { name: /siguiente|next/i }))
    await waitFor(() => expect(mocks.range).toHaveBeenLastCalledWith(0, 24))
    expect(await screen.findByText('Producto Sintético Uno')).toBeInTheDocument()
    expect(screen.queryByText(/No pudimos cargar/)).toBeNull()
  })

  it('ofrece la importación solo a quien puede migrar', async () => {
    abrir()
    await screen.findByText('Producto Sintético Uno')
    expect(screen.getByRole('link', { name: 'Importar ingresos anteriores' })).toHaveAttribute('href', '/migracion/importar/ingresos_archivo')
  })

  it('oculta la importación para un rol sin permiso de migrar', async () => {
    mocks.puedeEscribir = false
    abrir()
    await screen.findByText('Producto Sintético Uno')
    expect(screen.queryByRole('link', { name: 'Importar ingresos anteriores' })).toBeNull()
  })
})
