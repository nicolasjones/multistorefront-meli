import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useBuscarClientes: vi.fn(),
  useNivelSeccion: vi.fn(),
  usePuedeAccion: vi.fn(),
  usePuedeEscribir: vi.fn(),
  refetch: vi.fn(),
}))

vi.mock('../../hooks/useBuscarClientes', () => ({ useBuscarClientes: mocks.useBuscarClientes }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/usePuedeAccion', () => ({ usePuedeAccion: mocks.usePuedeAccion }))
vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: mocks.usePuedeEscribir }))
vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({
  useFiltroPorEmpresaActiva: () => ({ empresas: [], valor: 'e-1', cambiar: vi.fn(), empresaActivaId: 'e-1', cargando: false, hayError: false }),
}))
vi.mock('../../components/clientes/ExportarClientes', () => ({ ExportarClientes: () => null }))
vi.mock('@refinedev/mui', () => ({ CreateButton: () => <button type="button">Nuevo cliente</button> }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import type { ClienteListado } from '../../hooks/useBuscarClientes'
import { ClienteList } from './list'

const cliente = (n: number): ClienteListado => ({
  id: `c-${n}`, numero: n, nombre: `Cliente ${n}`, documento: null, correo: null, telefono: null, celular: null,
  localidad: null, expreso_preferido: null, tipo: 'minorista', es_consumidor_final: false, archivado_en: null, empresas: [], cuentas_web: [],
})

function Destino() {
  const { state } = useLocation()
  return <output data-testid="destino">{JSON.stringify(state)}</output>
}

const abrir = () => render(
  <MemoryRouter initialEntries={['/clientes']}>
    <Routes>
      <Route path="/clientes" element={<ClienteList />} />
      <Route path="/clientes/correo-masivo" element={<Destino />} />
    </Routes>
  </MemoryRouter>,
)

// F-CLI-11, FR-005: «Enviar correo a seleccionados (N)» del listado de Clientes.
describe('Listado de Clientes · Enviar correo a seleccionados', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.usePuedeAccion.mockReturnValue({ puede: false, isLoading: false })
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: false, isLoading: false })
    mocks.useBuscarClientes.mockReturnValue({
      clientes: [cliente(1), cliente(2), cliente(3)], total: 3, isLoading: false, isFetching: false, isError: false, refetch: mocks.refetch,
    })
  })

  it('sin selección avisa «Elegí al menos un cliente con las casillas» y no navega', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar correo a seleccionados' }))
    expect(await screen.findByText('Elegí al menos un cliente con las casillas')).toBeInTheDocument()
    expect(screen.queryByTestId('destino')).not.toBeInTheDocument()
  })

  it('con N marcados el botón dice «(N)» y lleva a esos N a «Correo masivo»', () => {
    abrir()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Cliente 1' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Cliente 3' }))
    fireEvent.click(screen.getByRole('button', { name: 'Enviar correo a seleccionados (2)' }))
    expect(JSON.parse(screen.getByTestId('destino').textContent!)).toEqual({ clientes: ['c-1', 'c-3'], empresaActivaId: 'e-1' })
  })

  it('al desmarcar todo vuelve a pedir una selección', async () => {
    abrir()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Cliente 1' }))
    expect(screen.getByRole('button', { name: 'Enviar correo a seleccionados (1)' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Cliente 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Enviar correo a seleccionados' }))
    expect(await screen.findByText('Elegí al menos un cliente con las casillas')).toBeInTheDocument()
  })

  it('con acceso de solo lectura no se ofrece enviar (ni casillas)', () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    abrir()
    expect(screen.queryByRole('button', { name: /Enviar correo a seleccionados/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Seleccionar Cliente 1' })).not.toBeInTheDocument()
  })
})
