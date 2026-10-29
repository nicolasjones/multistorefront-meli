import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useNivelSeccion: vi.fn(),
  useCreate: vi.fn(),
  useOne: vi.fn(),
  mutateCreate: vi.fn(),
  mutateUpdate: vi.fn(),
  useEmpresas: vi.fn(),
  useEmpresasDeCliente: vi.fn(),
  guardar: vi.fn(),
  useCuentasWebDeCliente: vi.fn(),
  useEmpresasAccesibles: vi.fn(),
  aplicarCuentaWeb: vi.fn(),
}))

vi.mock('@refinedev/core', () => ({
  useCreate: () => ({ mutateAsync: mocks.mutateCreate }),
  useOne: mocks.useOne,
  useUpdate: () => ({ mutateAsync: mocks.mutateUpdate }),
}))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/useEmpresas', () => ({ useEmpresas: mocks.useEmpresas }))
vi.mock('../../hooks/useEmpresasDeCliente', () => ({
  useEmpresasDeCliente: mocks.useEmpresasDeCliente,
  useGuardarEmpresasDeCliente: () => ({ guardar: mocks.guardar }),
}))
vi.mock('../../hooks/useCuentasWebDeCliente', () => ({ useCuentasWebDeCliente: mocks.useCuentasWebDeCliente }))
vi.mock('../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: mocks.useEmpresasAccesibles }))
vi.mock('../../lib/cuentasCliente', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/cuentasCliente')>()
  return { ...real, aplicarCuentaWebEnTiendas: mocks.aplicarCuentaWeb }
})
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import type { Cliente } from '../../lib/clientes'
import { ClienteCreate } from './create'
import { ClienteEdit } from './edit'

const EMPRESAS = [
  { id: 'e-1', nombre: 'San Javucho', activa: true },
  { id: 'e-2', nombre: 'Mundo JC', activa: true },
]

const cliente: Cliente = {
  id: 'c-1', numero: 7, nombre: 'Distribuidora Norte SRL', documento: null, correo: 'norte@example.com',
  telefono: null, celular: null, direccion: null, codigo_postal: null, localidad: null, provincia: null,
  expreso_preferido: null, archivado_en: null, tipo: 'minorista', es_consumidor_final: false, acepta_correo_masivo: false, created_at: '2026-10-16T10:00:00Z',
}

function Ficha() {
  const location = useLocation()
  return <p>{(location.state as { mensaje?: string } | null)?.mensaje ?? 'sin mensaje'}</p>
}

const abrir = (ruta: string, elemento: ReactNode) =>
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="/clientes/create" element={elemento} />
        <Route path="/clientes/edit/:id" element={elemento} />
        <Route path="/clientes/show/:id" element={<Ficha />} />
      </Routes>
    </MemoryRouter>,
  )

const escribir = (etiqueta: RegExp | string, valor: string) =>
  fireEvent.change(screen.getByLabelText(etiqueta), { target: { value: valor } })

describe('campo «Cuenta web» del formulario (FR-015)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.mutateCreate.mockResolvedValue({ data: { id: 'c-nuevo' } })
    mocks.mutateUpdate.mockResolvedValue({})
    mocks.useEmpresas.mockReturnValue({ empresas: EMPRESAS, isLoading: false, isError: false })
    mocks.useEmpresasDeCliente.mockReturnValue({ empresas: ['e-1', 'e-2'], isLoading: false, isError: false, refetch: vi.fn() })
    mocks.guardar.mockResolvedValue(undefined)
    mocks.useCuentasWebDeCliente.mockReturnValue({ cuentas: [], isLoading: false, isError: false, refetch: vi.fn() })
    mocks.useEmpresasAccesibles.mockReturnValue({ empresas: EMPRESAS, empresaActivaId: null, isLoading: false, isError: false, refetch: vi.fn() })
    mocks.aplicarCuentaWeb.mockResolvedValue({ creadas: 1, errores: 0 })
    mocks.useOne.mockReturnValue({ query: { data: { data: cliente }, isLoading: false, isError: false, refetch: vi.fn() } })
  })

  it('el alta muestra el campo, su nota, la casilla de invitación y «Habilitado en» con casillas', () => {
    abrir('/clientes/create', <ClienteCreate />)

    expect(screen.getByText('Cuenta web')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Cuenta web' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sin cuenta' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Activa' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Suspendida' })).toBeInTheDocument()
    expect(screen.getByText('El cliente compra sin registrarse.')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Enviar invitación por correo al crear la cuenta' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Habilitado en' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'San Javucho' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Mundo JC' })).toBeChecked()
  })

  it('al guardar «Activa» crea la cuenta en cada tienda tildada y avisa la invitación', async () => {
    abrir('/clientes/create', <ClienteCreate />)
    escribir(/nombre o razón social/i, 'Nuevo cliente')
    escribir('Correo', 'nuevo@example.com')
    fireEvent.click(screen.getByRole('button', { name: 'Activa' }))
    expect(screen.getByText('Puede ingresar a las tiendas con su correo.')).toBeInTheDocument()
    // Deja solo San Javucho tildada.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mundo JC' }))
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))

    await waitFor(() => expect(mocks.mutateCreate).toHaveBeenCalledTimes(1))
    expect(mocks.guardar).toHaveBeenCalledWith('c-nuevo', ['e-1'])
    expect(mocks.aplicarCuentaWeb).toHaveBeenCalledWith('c-nuevo', ['e-1'], 'activa', true)
    expect(await screen.findByText('Cliente creado · invitación enviada')).toBeInTheDocument()
  })

  it('sin la casilla de invitación crea la cuenta y avisa solo el alta', async () => {
    abrir('/clientes/create', <ClienteCreate />)
    escribir(/nombre o razón social/i, 'Nuevo cliente')
    fireEvent.click(screen.getByRole('button', { name: 'Activa' }))
    const invitacion = screen.getByRole('checkbox', { name: 'Enviar invitación por correo al crear la cuenta' })
    fireEvent.click(invitacion)
    expect(invitacion).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))

    await waitFor(() => expect(mocks.aplicarCuentaWeb).toHaveBeenCalledWith('c-nuevo', ['e-1', 'e-2'], 'activa', false))
    expect(await screen.findByText('Cliente creado')).toBeInTheDocument()
  })

  it('la edición parte del estado guardado y al pasar a Suspendida aplica el cambio', async () => {
    mocks.useCuentasWebDeCliente.mockReturnValue({
      cuentas: [{ empresa_id: 'e-1', estado: 'activa', correo: 'norte@example.com', ultimo_ingreso: null }],
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    abrir('/clientes/edit/c-1', <ClienteEdit />)

    expect(screen.getByRole('button', { name: 'Activa' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Suspendida' }))
    expect(screen.getByText('No puede ingresar hasta que lo reactives.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(mocks.mutateUpdate).toHaveBeenCalledTimes(1))
    expect(mocks.guardar).toHaveBeenCalledWith('c-1', ['e-1', 'e-2'])
    expect(mocks.aplicarCuentaWeb).toHaveBeenCalledWith('c-1', ['e-1', 'e-2'], 'suspendida', false, 'activa')
    expect(await screen.findByText('Cliente guardado')).toBeInTheDocument()
  })

  it('si una tienda falla, lo informa sin perder el cliente creado', async () => {
    mocks.aplicarCuentaWeb.mockResolvedValue({ creadas: 0, errores: 2 })
    abrir('/clientes/create', <ClienteCreate />)
    escribir(/nombre o razón social/i, 'Nuevo cliente')
    fireEvent.click(screen.getByRole('button', { name: 'Activa' }))
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))

    expect(await screen.findByText('Cliente creado · no se pudo crear la cuenta web en 2 tiendas')).toBeInTheDocument()
  })
})
