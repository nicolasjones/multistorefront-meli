import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../test/axe'

const mocks = vi.hoisted(() => ({
  useBuscarClientes: vi.fn(),
  useNivelSeccion: vi.fn(),
  usePuedeAccion: vi.fn(),
  usePuedeEscribir: vi.fn(),
  refetch: vi.fn(),
  rpc: vi.fn(),
  empresaActivaId: 'e-1' as string | null,
}))

vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))
vi.mock('../../hooks/useBuscarClientes', () => ({ useBuscarClientes: mocks.useBuscarClientes }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/usePuedeAccion', () => ({ usePuedeAccion: mocks.usePuedeAccion }))
vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: mocks.usePuedeEscribir }))
vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({
  useFiltroPorEmpresaActiva: () => ({ empresas: [], valor: mocks.empresaActivaId, cambiar: vi.fn(), empresaActivaId: mocks.empresaActivaId, cargando: false, hayError: false }),
}))
vi.mock('../../components/clientes/ExportarClientes', () => ({ ExportarClientes: () => null }))
vi.mock('../../components/clientes/ImportarClientes', () => ({ ImportarClientes: () => null }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import type { ClienteListado } from '../../hooks/useBuscarClientes'
import { ClienteList } from './list'

const cliente = (n: number): ClienteListado => ({
  id: `c-${n}`, numero: n, nombre: `Cliente ${n}`, documento: null, correo: null, telefono: null, celular: null,
  localidad: null, expreso_preferido: null, tipo: 'minorista', es_consumidor_final: false, archivado_en: null, empresas: [], cuentas_web: [],
})

const abrir = () => render(<MemoryRouter initialEntries={['/clientes']}><ClienteList /></MemoryRouter>)

describe('Listado de Clientes · Marcar aceptación', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.empresaActivaId = 'e-1'
    mocks.rpc.mockResolvedValue({ data: 2, error: null })
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.usePuedeAccion.mockReturnValue({ puede: false, isLoading: false })
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: true, isLoading: false })
    mocks.useBuscarClientes.mockReturnValue({
      clientes: [cliente(1), cliente(2), cliente(3)], total: 3, isLoading: false, isFetching: false, isError: false, refetch: mocks.refetch,
    })
  })

  it('solo el administrador ve el botón', () => {
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: false, isLoading: false })
    abrir()
    expect(screen.queryByRole('button', { name: /Marcar aceptación/ })).not.toBeInTheDocument()
  })

  it('sin selección el botón está deshabilitado', () => {
    abrir()
    expect(screen.getByRole('button', { name: 'Marcar aceptación' })).toBeDisabled()
  })

  it('marca a los seleccionados con la opción elegida y avisa cuántos cambiaron', async () => {
    abrir()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Cliente 1' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Cliente 3' }))
    fireEvent.click(screen.getByRole('button', { name: 'Marcar aceptación (2)' }))
    const dialogo = screen.getByRole('dialog', { name: 'Marcar aceptación' })
    fireEvent.click(within(dialogo).getByRole('radio', { name: 'No aceptan el correo masivo' }))
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Marcar' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('marcar_aceptacion_correo_clientes', { p_cliente_ids: ['c-1', 'c-3'], p_acepta: false }))
    expect(await screen.findByText('Se marcó que no aceptan el correo masivo a 2 clientes.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.refetch).toHaveBeenCalled()
  })

  it('si la base rechaza (no es administrador) lo dice y deja el diálogo abierto', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Solo un administrador puede marcar la aceptación de correo' } })
    abrir()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Cliente 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Marcar aceptación (1)' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Marcar' }))
    expect(await screen.findByText(/Solo un administrador puede marcar la aceptación de correo/)).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Marcar aceptación' })).toBeInTheDocument()
  })

  it('al cambiar de empresa cierra el diálogo sin enviar y descarta la selección', async () => {
    const vista = abrir()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Cliente 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Marcar aceptación (1)' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    mocks.empresaActivaId = 'e-2'
    await act(async () => { vista.rerender(<MemoryRouter initialEntries={['/clientes']}><ClienteList /></MemoryRouter>) })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Marcar aceptación' })).toBeDisabled()
    expect(await screen.findByText(/Cambiaste de empresa: se cerró «Marcar aceptación»/)).toBeInTheDocument()
  })

  it('el diálogo no tiene violaciones de accesibilidad', async () => {
    abrir()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Cliente 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Marcar aceptación (1)' }))
    expect(await violacionesAxe(screen.getByRole('dialog'))).toEqual([])
  })
})
