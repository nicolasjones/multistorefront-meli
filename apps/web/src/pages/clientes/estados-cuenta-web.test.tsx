import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../test/axe'

const mocks = vi.hoisted(() => ({
  useNivelSeccion: vi.fn(),
  useOne: vi.fn(),
  useCreate: vi.fn(),
  mutateCreate: vi.fn(),
  useEmpresas: vi.fn(),
  useEmpresasDeCliente: vi.fn(),
  guardar: vi.fn(),
  useCuentasWebDeCliente: vi.fn(),
  useEmpresasAccesibles: vi.fn(),
  useBuscarClientes: vi.fn(),
  usePuedeAccion: vi.fn(),
  usePuedeEscribir: vi.fn(),
  refetch: vi.fn(),
}))

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
vi.mock('../../lib/cuentasCliente', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/cuentasCliente')>()
  return { ...real, aplicarCuentaWebEnTiendas: vi.fn().mockResolvedValue({ creadas: 0, errores: 0 }) }
})
vi.mock('../../hooks/useEmpresasAccesibles', () => ({
  useEmpresasAccesibles: () => ({
    empresas: mocks.useEmpresasAccesibles(),
    empresaActivaId: null,
    isLoading: false,
    isError: false,
    refetch: mocks.refetch,
  }),
}))
vi.mock('../../components/clientes/ExportarClientes', () => ({ ExportarClientes: () => null }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../components/clientes/ComprasCliente', () => ({ ComprasCliente: () => null }))

import type { Cliente } from '../../lib/clientes'
import type { ClienteListado } from '../../hooks/useBuscarClientes'
import { ClienteShow } from './show'
import { ClienteList } from './list'
import { ClienteCreate } from './create'

const EMPRESAS = [
  { id: 'e-1', nombre: 'San Javucho', activa: true },
  { id: 'e-2', nombre: 'Mundo JC', activa: true },
  { id: 'e-3', nombre: 'Tienda Sur', activa: true },
  { id: 'e-4', nombre: 'Tienda Norte', activa: true },
]

const cliente: Cliente = {
  id: 'c-1', numero: 7, nombre: 'Distribuidora Norte SRL', documento: null, correo: 'norte@example.com',
  telefono: null, celular: null, direccion: null, codigo_postal: null, localidad: null, provincia: null,
  expreso_preferido: null, archivado_en: null, tipo: 'mayorista', es_consumidor_final: false, acepta_correo_masivo: false, created_at: '2026-10-16T10:00:00Z',
}

const listado = (n: number, cuentas: ClienteListado['cuentas_web']): ClienteListado => ({
  id: `c-${n}`, numero: n, nombre: `Cliente ${n}`, documento: null, correo: null, telefono: null, celular: null,
  localidad: null, expreso_preferido: null, tipo: 'minorista', es_consumidor_final: false, archivado_en: null,
  empresas: [], cuentas_web: cuentas,
})

const ficha = () => render(
  <MemoryRouter initialEntries={['/clientes/show/c-1']}>
    <Routes><Route path="/clientes/show/:id" element={<ClienteShow />} /></Routes>
  </MemoryRouter>,
)

function definirAncho(ancho: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: ancho })
}

describe('los cuatro estados de la cuenta web con axe (SC-003)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.usePuedeAccion.mockReturnValue({ puede: false, isLoading: false })
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: false, isLoading: false })
    mocks.useEmpresas.mockReturnValue({ empresas: EMPRESAS, isLoading: false, isError: false })
    mocks.useEmpresasDeCliente.mockReturnValue({ empresas: ['e-1', 'e-2', 'e-3'], isLoading: false, isError: false, refetch: mocks.refetch })
    mocks.useCuentasWebDeCliente.mockReturnValue({
      cuentas: [
        { empresa_id: 'e-1', estado: 'activa', correo: 'norte@example.com', ultimo_ingreso: '2026-10-05T18:20:00Z' },
        { empresa_id: 'e-2', estado: 'suspendida', correo: 'norte@example.com', ultimo_ingreso: null },
      ],
      isLoading: false, isError: false, refetch: mocks.refetch,
    })
    mocks.useEmpresasAccesibles.mockReturnValue(EMPRESAS)
    mocks.useOne.mockReturnValue({ query: { data: { data: cliente }, isLoading: false, isError: false, refetch: mocks.refetch } })
    mocks.useCreate.mockReturnValue({ mutateAsync: mocks.mutateCreate })
    mocks.mutateCreate.mockResolvedValue({ data: { id: 'c-nuevo' } })
    mocks.guardar.mockResolvedValue(undefined)
    mocks.useBuscarClientes.mockReturnValue({
      clientes: [
        listado(1, [{ empresa_id: 'e-1', estado: 'activa', correo: 'a@ejemplo.com', ultimo_ingreso: null }]),
        listado(2, [{ empresa_id: 'e-1', estado: 'suspendida', correo: 'b@ejemplo.com', ultimo_ingreso: null }]),
        listado(3, []),
      ],
      total: 3, isLoading: false, isFetching: false, isError: false, refetch: mocks.refetch,
    })
  })

  it.each([320, 768, 1440])('la ficha muestra Activa, Suspendida, Sin cuenta y No habilitado a %i px', async (ancho) => {
    definirAncho(ancho)
    const { container } = ficha()

    // San Javucho: Activa. Mundo JC: Suspendida. Tienda Sur: Sin cuenta. Tienda Norte: No habilitado.
    expect(screen.getByText('Puede ingresar a las tiendas con su correo.')).toBeInTheDocument()
    expect(await violacionesAxe(container)).toEqual([])

    fireEvent.click(screen.getByRole('tab', { name: 'Mundo JC' }))
    expect(screen.getByText('No puede ingresar hasta que la reactives.')).toBeInTheDocument()
    expect(await violacionesAxe(container)).toEqual([])

    fireEvent.click(screen.getByRole('tab', { name: 'Tienda Sur' }))
    expect(screen.getByText('El cliente compra sin registrarse.')).toBeInTheDocument()
    expect(await violacionesAxe(container)).toEqual([])

    fireEvent.click(screen.getByRole('tab', { name: 'Tienda Norte' }))
    expect(screen.getByText('El cliente no puede comprar en esta tienda.')).toBeInTheDocument()
    expect(await violacionesAxe(container)).toEqual([])
  })

  it.each([320, 768, 1440])('el listado muestra los estados de cuenta web a %i px', async (ancho) => {
    definirAncho(ancho)
    const { container } = render(<MemoryRouter><ClienteList /></MemoryRouter>)
    expect(screen.getByRole('columnheader', { name: 'Cuenta web' })).toBeInTheDocument()
    expect(screen.getAllByText('Activa').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Suspendida').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Sin cuenta').length).toBeGreaterThan(0)
    // «No habilitado» no es un estado de la columna del listado (D4): se ve en la ficha.
    expect(await violacionesAxe(container)).toEqual([])
  })

  it.each([320, 768, 1440])('el formulario muestra Sin cuenta, Activa y Suspendida a %i px', async (ancho) => {
    definirAncho(ancho)
    const { container } = render(
      <MemoryRouter initialEntries={['/clientes/create']}>
        <Routes><Route path="/clientes/create" element={<ClienteCreate />} /></Routes>
      </MemoryRouter>,
    )
    expect(screen.getByRole('group', { name: 'Cuenta web' })).toBeInTheDocument()
    expect(await violacionesAxe(container)).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Activa' }))
    expect(screen.getByText('Puede ingresar a las tiendas con su correo.')).toBeInTheDocument()
    expect(await violacionesAxe(container)).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Suspendida' }))
    expect(screen.getByText('No puede ingresar hasta que lo reactives.')).toBeInTheDocument()
    expect(await violacionesAxe(container)).toEqual([])
  })
})
