import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const estado = { empresaActiva: 'e-1' as string | null }
  return {
    estado,
    useBuscarClientes: vi.fn(),
    useNivelSeccion: vi.fn(),
    usePuedeAccion: vi.fn(),
    usePuedeEscribir: vi.fn(),
    useFiltroPorEmpresaActiva: vi.fn(),
    useOne: vi.fn(),
    useCreate: vi.fn(),
    mutateCreate: vi.fn(),
    useUpdate: vi.fn(),
    useEmpresas: vi.fn(),
    useEmpresasDeCliente: vi.fn(),
    guardar: vi.fn(),
    useCuentasWebDeCliente: vi.fn(),
    useEmpresasAccesibles: vi.fn(),
    refetch: vi.fn(),
    empresaSeleccionada: vi.fn(),
  }
})

vi.mock('@refinedev/core', () => ({
  useCreate: () => ({ mutateAsync: mocks.mutateCreate }),
  useOne: mocks.useOne,
  useUpdate: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock('@refinedev/mui', () => ({ CreateButton: () => <button type="button">Nuevo cliente</button> }))
vi.mock('../../hooks/useBuscarClientes', () => ({ useBuscarClientes: mocks.useBuscarClientes }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/usePuedeAccion', () => ({ usePuedeAccion: mocks.usePuedeAccion }))
vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: mocks.usePuedeEscribir }))
vi.mock('../../hooks/useEmpresas', () => ({ useEmpresas: mocks.useEmpresas }))
vi.mock('../../hooks/useEmpresasDeCliente', () => ({
  useEmpresasDeCliente: mocks.useEmpresasDeCliente,
  useGuardarEmpresasDeCliente: () => ({ guardar: mocks.guardar }),
}))
vi.mock('../../hooks/useCuentasWebDeCliente', () => ({ useCuentasWebDeCliente: mocks.useCuentasWebDeCliente }))
vi.mock('../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: () => ({ empresas: [], empresaActivaId: mocks.estado.empresaActiva, isLoading: false, isError: false, refetch: mocks.refetch }) }))
vi.mock('../../lib/cuentasCliente', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/cuentasCliente')>()
  return { ...real, aplicarCuentaWebEnTiendas: vi.fn().mockResolvedValue({ creadas: 0, errores: 0 }) }
})
vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({
  useFiltroPorEmpresaActiva: () => ({
    empresas: [{ id: 'e-1', nombre: 'San Javucho' }, { id: 'e-2', nombre: 'Mundo JC' }],
    valor: mocks.estado.empresaActiva,
    cambiar: mocks.empresaSeleccionada,
    empresaActivaId: mocks.estado.empresaActiva,
    cargando: false,
    hayError: false,
  }),
}))
vi.mock('../../components/clientes/ExportarClientes', () => ({ ExportarClientes: () => null }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../components/clientes/ComprasCliente', () => ({ ComprasCliente: () => null }))

import type { Cliente } from '../../lib/clientes'
import type { ClienteListado } from '../../hooks/useBuscarClientes'
import { ClienteList } from './list'
import { ClienteShow } from './show'
import { ClienteCreate } from './create'

const clienteListado = (n: number): ClienteListado => ({
  id: `c-${n}`, numero: n, nombre: `Cliente ${n}`, documento: null, correo: null, telefono: null, celular: null,
  localidad: null, expreso_preferido: null, tipo: 'minorista', es_consumidor_final: false, archivado_en: null,
  empresas: [], cuentas_web: [],
})

const cliente: Cliente = {
  id: 'c-1', numero: 7, nombre: 'Distribuidora Norte SRL', documento: null, correo: 'norte@example.com',
  telefono: null, celular: null, direccion: null, codigo_postal: null, localidad: null, provincia: null,
  expreso_preferido: null, archivado_en: null, tipo: 'minorista', es_consumidor_final: false, created_at: '2026-10-16T10:00:00Z',
}

const abrirListado = () => render(<MemoryRouter><ClienteList /></MemoryRouter>)
const abrirFicha = () => render(
  <MemoryRouter initialEntries={['/clientes/show/c-1']}>
    <Routes><Route path="/clientes/show/:id" element={<ClienteShow />} /></Routes>
  </MemoryRouter>,
)
const abrirAlta = () => render(
  <MemoryRouter initialEntries={['/clientes/create']}>
    <Routes><Route path="/clientes/create" element={<ClienteCreate />} /></Routes>
  </MemoryRouter>,
)

describe('empresa activa en Clientes (FR-017, SC-004, Principio VIII)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.estado.empresaActiva = 'e-1'
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.usePuedeAccion.mockReturnValue({ puede: false, isLoading: false })
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: false, isLoading: false })
    mocks.useBuscarClientes.mockReturnValue({
      clientes: [clienteListado(1)], total: 60, isLoading: false, isFetching: false, isError: false, refetch: mocks.refetch,
    })
    mocks.useOne.mockReturnValue({ query: { data: { data: cliente }, isLoading: false, isError: false, refetch: mocks.refetch } })
    mocks.useCreate.mockReturnValue({ mutateAsync: mocks.mutateCreate })
    mocks.mutateCreate.mockResolvedValue({ data: { id: 'c-nuevo' } })
    mocks.useEmpresas.mockReturnValue({
      empresas: [{ id: 'e-1', nombre: 'San Javucho', activa: true }, { id: 'e-2', nombre: 'Mundo JC', activa: true }],
      isLoading: false, isError: false,
    })
    mocks.useEmpresasDeCliente.mockReturnValue({ empresas: ['e-1'], isLoading: false, isError: false, refetch: mocks.refetch })
    mocks.useCuentasWebDeCliente.mockReturnValue({
      cuentas: [{ empresa_id: 'e-1', estado: 'activa', correo: 'norte@example.com', ultimo_ingreso: null }],
      isLoading: false, isError: false, refetch: mocks.refetch,
    })
    mocks.guardar.mockResolvedValue(undefined)
  })

  it('el listado vuelve a la página 1, descarta la selección y recarga con la nueva tienda', async () => {
    const { rerender } = abrirListado()
    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente/i }))
    expect(mocks.useBuscarClientes.mock.calls.at(-1)![0]).toMatchObject({ empresaId: 'e-1', pagina: 2 })
    // La selección de filas de la empresa anterior queda vacía al cambiar de empresa.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Cliente 1' }))
    expect(screen.getByRole('checkbox', { name: 'Seleccionar Cliente 1' })).toBeChecked()

    mocks.estado.empresaActiva = 'e-2'
    rerender(<MemoryRouter><ClienteList /></MemoryRouter>)

    await waitFor(() => expect(mocks.useBuscarClientes.mock.calls.at(-1)![0]).toMatchObject({ empresaId: 'e-2', pagina: 1 }))
    expect(screen.getByRole('checkbox', { name: 'Seleccionar Cliente 1' })).not.toBeChecked()
  })

  it('la ficha se reencuadra a la nueva tienda y no muestra el estado de la anterior', async () => {
    mocks.useEmpresasDeCliente.mockReturnValue({ empresas: ['e-1', 'e-2'], isLoading: false, isError: false, refetch: mocks.refetch })
    mocks.useCuentasWebDeCliente.mockReturnValue({
      cuentas: [
        { empresa_id: 'e-1', estado: 'activa', correo: 'norte@example.com', ultimo_ingreso: null },
        { empresa_id: 'e-2', estado: 'suspendida', correo: 'norte@example.com', ultimo_ingreso: null },
      ],
      isLoading: false, isError: false, refetch: mocks.refetch,
    })
    const { rerender } = abrirFicha()
    expect(screen.getByRole('tab', { name: 'San Javucho' })).toHaveAttribute('aria-selected', 'true')
    expect(within(screen.getByRole('heading', { name: 'Cuenta web' }).parentElement!).getByText('Activa')).toBeInTheDocument()

    mocks.estado.empresaActiva = 'e-2'
    rerender(
      <MemoryRouter initialEntries={['/clientes/show/c-1']}>
        <Routes><Route path="/clientes/show/:id" element={<ClienteShow />} /></Routes>
      </MemoryRouter>,
    )

    expect(screen.getByRole('tab', { name: 'Mundo JC' })).toHaveAttribute('aria-selected', 'true')
    const bloque = within(screen.getByRole('heading', { name: 'Cuenta web' }).parentElement!)
    expect(bloque.getByText('Suspendida')).toBeInTheDocument()
    expect(bloque.queryByText('Activa')).not.toBeInTheDocument()
  })

  it('el formulario abierto se reencuadra: no conserva lo escrito ni la selección de la empresa anterior', async () => {
    const { rerender } = abrirAlta()
    fireEvent.change(screen.getByLabelText(/nombre o razón social/i), { target: { value: 'Cargado en San Javucho' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mundo JC' }))
    expect(screen.getByLabelText(/nombre o razón social/i)).toHaveValue('Cargado en San Javucho')
    expect(screen.getByRole('checkbox', { name: 'Mundo JC' })).not.toBeChecked()

    mocks.estado.empresaActiva = 'e-2'
    rerender(
      <MemoryRouter initialEntries={['/clientes/create']}>
        <Routes><Route path="/clientes/create" element={<ClienteCreate />} /></Routes>
      </MemoryRouter>,
    )
    await act(async () => undefined)

    expect(screen.getByLabelText(/nombre o razón social/i)).toHaveValue('')
    expect(screen.getByRole('checkbox', { name: 'Mundo JC' })).toBeChecked()
  })
})
