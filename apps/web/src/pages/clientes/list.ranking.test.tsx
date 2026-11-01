import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ useBuscarClientes: vi.fn(), useNivelSeccion: vi.fn(), usePuedeAccion: vi.fn(), usePuedeEscribir: vi.fn(), useFiltroPorEmpresaActiva: vi.fn() }))

vi.mock('../../hooks/useBuscarClientes', () => ({ useBuscarClientes: mocks.useBuscarClientes }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/usePuedeAccion', () => ({ usePuedeAccion: mocks.usePuedeAccion }))
vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: mocks.usePuedeEscribir }))
vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: mocks.useFiltroPorEmpresaActiva }))
vi.mock('../../components/clientes/ExportarClientes', () => ({ ExportarClientes: () => null }))
vi.mock('../../components/clientes/ClientesInactivos', () => ({
  ClientesInactivos: ({ empresaId }: { empresaId?: string | null }) => <p>Contenido de inactivos {empresaId ?? 'todas'}</p>,
}))
vi.mock('../../components/clientes/RankingClientes', () => ({ RankingClientes: () => <p>Contenido del ranking</p> }))
vi.mock('@refinedev/mui', () => ({ CreateButton: () => <button type="button">Nuevo cliente</button> }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { ClienteList } from './list'

const abrir = () => render(<MemoryRouter><ClienteList /></MemoryRouter>)

describe('ClienteList · solapa de ranking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.usePuedeAccion.mockReturnValue({ puede: false, isLoading: false })
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: false, isLoading: false })
    mocks.useFiltroPorEmpresaActiva.mockReturnValue({ empresas: [], valor: null, cambiar: vi.fn(), cargando: false, hayError: false })
    mocks.useBuscarClientes.mockReturnValue({
      clientes: [], total: 0, isLoading: false, isFetching: false, isError: false, refetch: vi.fn(),
    })
  })

  it.each(['lectura', 'edicion'])('con %s muestra las solapas y abre el ranking de forma diferida', async (nivel) => {
    mocks.useNivelSeccion.mockReturnValue({ nivel, isLoading: false })
    abrir()
    expect(screen.getByRole('tablist', { name: 'Vistas de clientes' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Listado', selected: true })).toBeInTheDocument()
    expect(screen.queryByText('Contenido del ranking')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Ranking por facturación' }))
    expect(await screen.findByText('Contenido del ranking')).toBeInTheDocument()
    expect(screen.queryByLabelText('Buscar clientes')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Listado' }))
    expect(screen.getByLabelText('Buscar clientes')).toBeInTheDocument()
  })

  it('abre «Clientes inactivos» de forma diferida con la tienda elegida', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    mocks.useFiltroPorEmpresaActiva.mockReturnValue({ empresas: [], valor: 'e-3', cambiar: vi.fn(), cargando: false, hayError: false })
    abrir()
    expect(screen.queryByText(/Contenido de inactivos/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Clientes inactivos' }))
    expect(await screen.findByText('Contenido de inactivos e-3')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Clientes inactivos', selected: true })).toBeInTheDocument()
  })

  it('sin acceso a Clientes (ninguno) no ofrece la solapa de inactivos', () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'ninguno', isLoading: false })
    abrir()
    expect(screen.queryByRole('tab', { name: 'Clientes inactivos' })).not.toBeInTheDocument()
  })

  it('sin acceso a Clientes (ninguno) no ofrece la solapa de ranking', () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'ninguno', isLoading: false })
    abrir()
    expect(screen.queryByRole('tab', { name: 'Ranking por facturación' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it('mientras carga el nivel de permisos no ofrece la solapa', () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: null, isLoading: true })
    abrir()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  })
})
