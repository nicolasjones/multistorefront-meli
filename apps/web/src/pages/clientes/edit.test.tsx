import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useOne: vi.fn(),
  mutateAsync: vi.fn(),
  useNivelSeccion: vi.fn(),

  useEmpresas: vi.fn(),
  useEmpresasDeCliente: vi.fn(),
  useCuentasWebDeCliente: vi.fn(),
  useEmpresasAccesibles: vi.fn(),
  guardar: vi.fn(),
  aplicarCuentaWeb: vi.fn(),
}))

vi.mock('@refinedev/core', () => ({
  useOne: mocks.useOne,
  useUpdate: () => ({ mutateAsync: mocks.mutateAsync }),
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
import { ClienteEdit } from './edit'

const cliente: Cliente = {
  id: 'c-1', numero: 7, nombre: 'Distribuidora Norte SRL', documento: null, correo: null,
  telefono: null, celular: null, direccion: null, codigo_postal: null, localidad: null, provincia: null, expreso_preferido: null,
  archivado_en: null, tipo: 'minorista', es_consumidor_final: false, created_at: '2026-10-16T10:00:00Z',
}

const abrir = () =>
  render(
    <MemoryRouter initialEntries={['/clientes/edit/c-1']}>
      <Routes>
        <Route path="/clientes/edit/:id" element={<ClienteEdit />} />
        <Route path="/clientes/show/:id" element={<p>Ficha</p>} />
      </Routes>
    </MemoryRouter>,
  )

const conCliente = (datos: Partial<Cliente>) =>
  mocks.useOne.mockReturnValue({ query: { data: { data: { ...cliente, ...datos } }, isLoading: false, isError: false, refetch: vi.fn() } })

describe('ClienteEdit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.mutateAsync.mockResolvedValue({})

    mocks.useEmpresas.mockReturnValue({ empresas: [], isLoading: false, isError: false })
    mocks.useEmpresasDeCliente.mockReturnValue({ empresas: [], isLoading: false, isError: false, refetch: vi.fn() })
    mocks.guardar.mockResolvedValue(undefined)
    mocks.useCuentasWebDeCliente.mockReturnValue({ cuentas: [], isLoading: false, isError: false, refetch: vi.fn() })
    mocks.useEmpresasAccesibles.mockReturnValue({ empresas: [], empresaActivaId: null, isLoading: false, isError: false, refetch: vi.fn() })
    mocks.aplicarCuentaWeb.mockResolvedValue({ creadas: 0, errores: 0 })
    conCliente({})
  })

  it('cambiar el tipo avisa y guarda el nuevo tipo', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: /Mayorista/ }))
    expect(screen.getByText(/próximas ventas usarán la escala/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ resource: 'clientes', id: 'c-1', values: expect.objectContaining({ tipo: 'mayorista' }) }),
      ),
    )
    expect(await screen.findByText('Ficha')).toBeInTheDocument()
  })

  it('sin permiso de edición no ofrece el formulario', () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    abrir()
    expect(screen.getByText('Sin permiso')).toBeInTheDocument()
    expect(screen.queryByLabelText('Tipo de cliente')).not.toBeInTheDocument()
  })

  it('el Consumidor final no se edita aunque se llegue por URL directa', () => {
    conCliente({ es_consumidor_final: true, nombre: 'Consumidor final' })
    abrir()
    expect(screen.getByText('No se puede editar')).toBeInTheDocument()
    expect(screen.queryByLabelText('Tipo de cliente')).not.toBeInTheDocument()
    expect(mocks.mutateAsync).not.toHaveBeenCalled()
  })
})
