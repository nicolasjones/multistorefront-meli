import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useLibretaContactos: vi.fn(),
  useNivelSeccion: vi.fn(),
  useFiltroPorEmpresaActiva: vi.fn(),
  useEmpresaActivaCambio: vi.fn(),
  refetch: vi.fn(),
}))

vi.mock('../../hooks/useContactos', () => ({
  useLibretaContactos: mocks.useLibretaContactos,
  useEmpresaActivaCambio: mocks.useEmpresaActivaCambio,
  AVISO_CAMBIO_EMPRESA: 'aviso',
}))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: mocks.useFiltroPorEmpresaActiva }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import type { Contacto } from '../../lib/contactos'
import { ContactoList } from './list'

const contacto = (extra: Partial<Contacto> = {}): Contacto => ({
  id: 'k1000000-0000-0000-0000-000000000001',
  empresa_id: 'e-1',
  empresa_nombre: 'San Javucho',
  nombre: 'Ana Pérez',
  correo: 'ana@example.com',
  telefono: '+54 9 11 5555-1234',
  anonimizado: false,
  updated_at: '2026-10-23T11:48:00.000Z',
  ...extra,
})

const libreta = (filas: Contacto[], extra: Record<string, unknown> = {}) => ({
  contactos: filas, total: filas.length, isLoading: false, isFetching: false, isError: false, refetch: mocks.refetch, ...extra,
})

const empresas = [{ id: 'e-1', nombre: 'San Javucho' }, { id: 'e-2', nombre: 'Mundo JC' }]
const estadoFiltro = { empresaActivaId: 'e-1' as string | null }

const abrir = () => render(<MemoryRouter><ContactoList /></MemoryRouter>)
const ultimosFiltros = () => mocks.useLibretaContactos.mock.calls.at(-1)![0]

describe('ContactoList (F-CON-05, FR-005, FR-012)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    estadoFiltro.empresaActivaId = 'e-1'
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.useEmpresaActivaCambio.mockReturnValue(false)
    mocks.useLibretaContactos.mockReturnValue(libreta([contacto()]))
    mocks.useFiltroPorEmpresaActiva.mockImplementation(() => ({
      empresas, valor: estadoFiltro.empresaActivaId, cambiar: vi.fn(), empresaActivaId: estadoFiltro.empresaActivaId, cargando: false, hayError: false,
    }))
  })

  it('lista la libreta de la empresa activa con nombre, correo, teléfono y estado', () => {
    abrir()
    expect(screen.getByRole('link', { name: 'Ana Pérez' })).toHaveAttribute('href', '/contactos/k1000000-0000-0000-0000-000000000001')
    expect(screen.getAllByText('ana@example.com').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Activo').length).toBeGreaterThan(0)
    expect(ultimosFiltros()).toMatchObject({ empresaId: 'e-1', pagina: 1 })
  })

  it('marca como Anonimizado a quien ya lo está', () => {
    mocks.useLibretaContactos.mockReturnValue(libreta([contacto({ nombre: 'Anonimizado', correo: null, telefono: null, anonimizado: true })]))
    abrir()
    expect(screen.getAllByText('Anonimizado').length).toBeGreaterThan(1)
  })

  it('muestra los estados de carga, error con reintento y vacío', () => {
    mocks.useLibretaContactos.mockReturnValue(libreta([], { isLoading: true }))
    const { unmount } = abrir()
    expect(screen.queryByRole('link', { name: 'Ana Pérez' })).not.toBeInTheDocument()
    unmount()

    mocks.useLibretaContactos.mockReturnValue(libreta([], { isError: true }))
    const segundo = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(mocks.refetch).toHaveBeenCalled()
    segundo.unmount()

    estadoFiltro.empresaActivaId = null
    mocks.useLibretaContactos.mockReturnValue(libreta([]))
    abrir()
    expect(screen.getByText('Todavía no hay contactos.')).toBeInTheDocument()
  })

  it('busca con espera y vuelve a la página 1', () => {
    vi.useFakeTimers()
    abrir()
    fireEvent.change(screen.getByLabelText('Buscar contactos'), { target: { value: 'ana' } })
    act(() => { vi.advanceTimersByTime(400) })
    expect(ultimosFiltros()).toMatchObject({ texto: 'ana', pagina: 1 })
    vi.useRealTimers()
  })

  it('con lectura «Nuevo contacto» está deshabilitado', () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    abrir()
    expect(screen.getByRole('button', { name: 'Nuevo contacto' })).toBeDisabled()
  })

  it('cambiar la empresa activa recarga con la nueva empresa y vuelve a la página 1', () => {
    vi.useFakeTimers()
    mocks.useLibretaContactos.mockReturnValue(libreta([contacto()], { total: 60 }))
    const { rerender } = abrir()
    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente/i, hidden: true }))
    expect(ultimosFiltros().pagina).toBe(2)
    estadoFiltro.empresaActivaId = 'e-2'
    rerender(<MemoryRouter><ContactoList /></MemoryRouter>)
    expect(ultimosFiltros()).toMatchObject({ empresaId: 'e-2', pagina: 1 })
    vi.useRealTimers()
  })
})
