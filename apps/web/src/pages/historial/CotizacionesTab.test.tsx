import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

const mocks = vi.hoisted(() => ({
  useHistorialCotizaciones: vi.fn(),
  useHistorialVentasCobros: vi.fn(),
  useEmpresasAccesibles: vi.fn(),
  useOrganizacionActiva: vi.fn(),
  refetch: vi.fn(),
  setTexto: vi.fn(),
  setPagina: vi.fn(),
}))

vi.mock('../../hooks/useHistorialCotizaciones', () => ({ useHistorialCotizaciones: mocks.useHistorialCotizaciones }))
vi.mock('../../hooks/useHistorialVentasCobros', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/useHistorialVentasCobros')>()),
  useHistorialVentasCobros: mocks.useHistorialVentasCobros,
}))
vi.mock('../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: mocks.useEmpresasAccesibles }))
vi.mock('../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: mocks.useOrganizacionActiva }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import type { CotizacionHistorica } from '../../hooks/useHistorialCotizaciones'
import { HistorialList } from './list'

const cotizacion = (n: number, extra: Partial<CotizacionHistorica> = {}): CotizacionHistorica => ({
  id: `c-${n}`, fecha: '2020-03-05', dolar_comprador: 64.25, dolar_vendedor: 68.75, cargado_por: 'Emilse', ...extra,
})

const respuesta = (filas: CotizacionHistorica[], extra: Record<string, unknown> = {}) => ({
  filas, total: filas.length, texto: '', textoAplicado: '', pagina: 1,
  setTexto: mocks.setTexto, setPagina: mocks.setPagina, isLoading: false, isFetching: false, isError: false, refetch: mocks.refetch, ...extra,
})

const abrirCotizaciones = () => {
  render(<MemoryRouter><HistorialList /></MemoryRouter>)
  fireEvent.click(screen.getByRole('tab', { name: 'Cotizaciones del dólar' }))
}

describe('Pestaña Cotizaciones del dólar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
    mocks.useEmpresasAccesibles.mockReturnValue({
      empresas: [{ id: 'e-1', nombre: 'San Javucho', esActiva: false, rolId: null }], empresaActivaId: null, isLoading: false, isError: false,
    })
    mocks.useOrganizacionActiva.mockReturnValue({ organizacionActiva: { id: 'o-1', nombre: 'Org 1' }, isLoading: false })
    mocks.useHistorialVentasCobros.mockReturnValue({ ...respuesta([]), desde: null, hasta: null })
    mocks.useHistorialCotizaciones.mockReturnValue(respuesta([cotizacion(1), cotizacion(2, { cargado_por: null })]))
  })
  afterEach(() => vi.restoreAllMocks())

  it('muestra las columnas Fecha, Dólar comprador, Dólar vendedor y Cargó con sus valores', () => {
    abrirCotizaciones()
    const tabla = screen.getByRole('table', { name: 'Cotizaciones del dólar históricas' })
    expect(within(tabla).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Fecha', 'Dólar comprador', 'Dólar vendedor', 'Cargó'])
    const filas = within(tabla).getAllByRole('row')
    expect(within(filas[1]).getByText('$ 64,25')).toBeInTheDocument()
    expect(within(filas[1]).getByText('$ 68,75')).toBeInTheDocument()
    expect(within(filas[1]).getByText('Emilse')).toBeInTheDocument()
    expect(within(filas[2]).getByText('—')).toBeInTheDocument()
    expect(screen.getByText('2 registros mostrados')).toBeInTheDocument()
  })

  it('busca por fecha con el campo «Buscar por fecha»', () => {
    abrirCotizaciones()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar por fecha' }), { target: { value: '05/03/2020' } })
    expect(mocks.setTexto).toHaveBeenCalledWith('05/03/2020')
  })

  it('es global: sin filtro de tienda, y solo lectura (sin acciones de edición)', () => {
    abrirCotizaciones()
    expect(screen.queryByRole('group', { name: 'Filtrar por tienda' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /editar|anular|borrar|eliminar|nueva/i })).not.toBeInTheDocument()
    expect(screen.getByText('Solo lectura')).toBeInTheDocument()
  })

  it('la consulta no recibe tienda ni empresa activa', () => {
    abrirCotizaciones()
    expect(mocks.useHistorialCotizaciones).toHaveBeenCalledWith()
  })

  it('estados: cargando, error con «Reintentar», sin resultados y vacío', () => {
    mocks.useHistorialCotizaciones.mockReturnValue(respuesta([], { isLoading: true }))
    abrirCotizaciones()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    mocks.useHistorialCotizaciones.mockReturnValue(respuesta([], { isError: true }))
    fireEvent.click(screen.getByRole('tab', { name: 'Ventas' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Cotizaciones del dólar' }))
    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }))
    expect(mocks.refetch).toHaveBeenCalled()

    mocks.useHistorialCotizaciones.mockReturnValue(respuesta([], { textoAplicado: '31/12/2099' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Ventas' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Cotizaciones del dólar' }))
    expect(screen.getByText('Sin resultados')).toBeInTheDocument()

    mocks.useHistorialCotizaciones.mockReturnValue(respuesta([]))
    fireEvent.click(screen.getByRole('tab', { name: 'Ventas' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Cotizaciones del dólar' }))
    expect(screen.getByText('Todavía no hay historial importado.')).toBeInTheDocument()
  })

  it('paginación en servidor: pide la página siguiente', () => {
    mocks.useHistorialCotizaciones.mockReturnValue(respuesta([cotizacion(1)], { total: 60 }))
    abrirCotizaciones()
    expect(screen.getByText('Página 1 · 1–25 de 60')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /siguiente/i }))
    expect(mocks.setPagina).toHaveBeenCalledWith(2)
  })

  it('en angosto se ven como tarjetas con los mismos datos', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: true, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
    abrirCotizaciones()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getAllByText('Emilse').length).toBeGreaterThan(0)
  })
})
