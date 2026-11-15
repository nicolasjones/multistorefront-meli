import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mutateCreate: vi.fn(),
  guardar: vi.fn(),
  rpc: vi.fn(),
  invoke: vi.fn(),
  aplicar: vi.fn(),
}))

vi.mock('@refinedev/core', () => ({ useCreate: () => ({ mutateAsync: mocks.mutateCreate }) }))
vi.mock('../../lib/supabase', () => ({
  supabaseClient: { rpc: mocks.rpc, functions: { invoke: mocks.invoke } },
}))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: () => ({ nivel: 'edicion', isLoading: false }) }))
vi.mock('../../hooks/useEmpresas', () => ({
  useEmpresas: () => ({ empresas: [{ id: 'e-1', nombre: 'San Javucho', activa: true }], isLoading: false, isError: false }),
}))
vi.mock('../../hooks/useEmpresasDeCliente', () => ({ useGuardarEmpresasDeCliente: () => ({ guardar: mocks.guardar }) }))
vi.mock('../../hooks/useEmpresasAccesibles', () => ({
  useEmpresasAccesibles: () => ({ empresas: [], empresaActivaId: null, isLoading: false, isError: false, refetch: vi.fn() }),
}))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

vi.mock('../../lib/cuentasCliente', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/cuentasCliente')>()
  return { ...real, aplicarCuentaWebEnTiendas: (...args: unknown[]) => mocks.aplicar(...args) }
})

import { ClienteCreate } from './create'

function Ficha() {
  const { state } = useLocation()
  return <p>Ficha: {(state as { mensaje?: string } | null)?.mensaje}</p>
}

describe('alta de cliente cuando falla la lectura de cuentas web (MSF-694)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mutateCreate.mockResolvedValue({ data: { id: 'c-nuevo' } })
    mocks.guardar.mockResolvedValue(undefined)
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'boom', code: '42501' } })
    mocks.aplicar.mockImplementation(async () => ({ creadas: 0, errores: 1 }))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('crea el cliente una sola vez y sigue a la ficha con el aviso, sin volver al formulario', async () => {
    render(
      <MemoryRouter initialEntries={['/clientes/create']}>
        <Routes>
          <Route path="/clientes/create" element={<ClienteCreate />} />
          <Route path="/clientes/show/:id" element={<Ficha />} />
        </Routes>
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: 'Cliente Nuevo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Activa' }))
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))

    expect(await screen.findByText('Ficha: Cliente creado · no se pudo crear la cuenta web en 1 tienda')).toBeInTheDocument()
    await waitFor(() => expect(mocks.mutateCreate).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/No pudimos guardar el cliente/)).not.toBeInTheDocument()
  })
})

describe('alta de cliente cuando aplicarCuentaWebEnTiendas rechaza (MSF-734)', () => {
  it('no muestra el error del formulario ni reintenta: crea una sola vez y va a la ficha con el aviso', async () => {
    mocks.mutateCreate.mockResolvedValue({ data: { id: 'c-nuevo' } })
    mocks.guardar.mockResolvedValue(undefined)
    mocks.aplicar.mockRejectedValue(new Error('inesperado'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(
      <MemoryRouter initialEntries={['/clientes/create']}>
        <Routes>
          <Route path="/clientes/create" element={<ClienteCreate />} />
          <Route path="/clientes/show/:id" element={<Ficha />} />
        </Routes>
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: 'Cliente Nuevo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Activa' }))
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))

    expect(await screen.findByText('Ficha: Cliente creado · no se pudo crear la cuenta web en 1 tienda')).toBeInTheDocument()
    expect(mocks.mutateCreate).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/No pudimos guardar el cliente/)).not.toBeInTheDocument()
  })
})
