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
  esAdministrador: vi.fn(),
  asignarLista: vi.fn(),
}))

vi.mock('@refinedev/core', () => ({
  useOne: mocks.useOne,
  useUpdate: () => ({ mutateAsync: mocks.mutateAsync }),
}))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/useEsAdministrador', () => ({ useEsAdministrador: () => ({ esAdministrador: mocks.esAdministrador(), isLoading: false }) }))
vi.mock('../../hooks/useEmpresas', () => ({ useEmpresas: mocks.useEmpresas }))
vi.mock('../../hooks/useListasPreciosActivas', () => ({
  useListasPreciosActivas: () => ({
    listas: [{ id: 'l-1', nombre: 'Revendedores', descripcion: null, ajustePct: -20, archivadaEn: null, clientesAsignados: 0, actualizadoEn: 't' }],
    cargando: false,
    hayError: false,
  }),
}))
vi.mock('../../lib/supabase', () => ({ supabaseClient: {} }))
vi.mock('../../lib/listasPrecios', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/listasPrecios')>()),
  asignarListaPrecios: mocks.asignarLista,
}))
vi.mock('../../hooks/useBanderaListasPrecios', () => ({ useBanderaListasPrecios: () => ({ activa: true, cargando: false, hayError: false }) }))
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
  archivado_en: null, tipo: 'minorista', es_consumidor_final: false, acepta_correo_masivo: false, created_at: '2026-10-16T10:00:00Z',
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
    mocks.esAdministrador.mockReturnValue(false)
    mocks.asignarLista.mockResolvedValue(undefined)
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

  it('si no se pueden cargar las tiendas del cliente, no ofrece el formulario', () => {
    mocks.useEmpresasDeCliente.mockReturnValue({ empresas: [], isLoading: false, isError: true, refetch: vi.fn() })
    abrir()
    expect(screen.getByText('No pudimos cargar las tiendas del cliente.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Tipo de cliente')).not.toBeInTheDocument()
  })

  it('si falla la lectura de las cuentas web, no ofrece el formulario ni guarda nada', () => {
    mocks.useCuentasWebDeCliente.mockReturnValue({ cuentas: [], isLoading: false, isError: true, refetch: vi.fn() })
    abrir()
    expect(screen.getByText('No pudimos cargar la cuenta web del cliente.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument()
    expect(mocks.mutateAsync).not.toHaveBeenCalled()
  })

  it('preselecciona las tiendas del cliente y guarda la selección elegida', async () => {
    mocks.useEmpresas.mockReturnValue({ empresas: [{ id: 'e-1', nombre: 'San Javucho', activa: true }], isLoading: false, isError: false })
    mocks.useEmpresasDeCliente.mockReturnValue({ empresas: ['e-1'], isLoading: false, isError: false, refetch: vi.fn() })
    abrir()
    expect(screen.getByRole('checkbox', { name: 'San Javucho' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(mocks.guardar).toHaveBeenCalledWith('c-1', ['e-1']))
  })

  it('el Administrador asigna la lista de precios por RPC (no por la tabla) antes de guardar la ficha', async () => {
    mocks.esAdministrador.mockReturnValue(true)
    abrir()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Lista de precios/ }))
    fireEvent.click(screen.getByRole('option', { name: /Revendedores/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(mocks.asignarLista).toHaveBeenCalledWith({}, 'c-1', 'l-1'))
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalled())
    expect(mocks.mutateAsync.mock.calls[0][0].values).not.toHaveProperty('lista_precio_id')
    expect(mocks.asignarLista.mock.invocationCallOrder[0]).toBeLessThan(mocks.mutateAsync.mock.invocationCallOrder[0])
  })

  it('si la base rechaza la asignación no guarda la ficha y muestra el error', async () => {
    mocks.esAdministrador.mockReturnValue(true)
    mocks.asignarLista.mockRejectedValue({ code: '55000', message: 'desactivadas' })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    abrir()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Lista de precios/ }))
    fireEvent.click(screen.getByRole('option', { name: /Revendedores/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText('No se guardó el cliente.')).toBeInTheDocument()
    expect(mocks.mutateAsync).not.toHaveBeenCalled()
  })

  it('si falla el guardado de la ficha después de asignar la lista, la lista vuelve a la anterior', async () => {
    mocks.esAdministrador.mockReturnValue(true)
    conCliente({ lista_precio_id: 'l-0' })
    mocks.mutateAsync.mockRejectedValue(new Error('falló'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    abrir()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Lista de precios/ }))
    fireEvent.click(screen.getByRole('option', { name: /Revendedores/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText('No se guardó el cliente.')).toBeInTheDocument()
    expect(mocks.asignarLista).toHaveBeenNthCalledWith(1, {}, 'c-1', 'l-1')
    expect(mocks.asignarLista).toHaveBeenNthCalledWith(2, {}, 'c-1', 'l-0')
  })

  it('quien no es Administrador ve la lista en solo lectura y nunca la asigna', async () => {
    conCliente({ lista_precio_id: 'l-1' })
    abrir()
    expect(screen.getByRole('combobox', { name: /Lista de precios/ })).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalled())
    expect(mocks.asignarLista).not.toHaveBeenCalled()
  })
})
