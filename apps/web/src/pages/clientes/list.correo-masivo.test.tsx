import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
vi.mock('@refinedev/mui', () => ({ CreateButton: () => <button type="button">Nuevo cliente</button> }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import type { ClienteListado } from '../../hooks/useBuscarClientes'
import { ClienteList } from './list'

const cliente = (n: number): ClienteListado => ({
  id: `c-${n}`, numero: n, nombre: `Cliente ${n}`, documento: null, correo: null, telefono: null, celular: null,
  localidad: null, expreso_preferido: null, tipo: 'minorista', es_consumidor_final: false, archivado_en: null, empresas: [], cuentas_web: [],
})

const abrir = () => render(
  <MemoryRouter initialEntries={['/clientes']}>
    <ClienteList />
  </MemoryRouter>,
)

// FR-005 (F-CLI-11) y FR-011 (F-CLI-12): «Enviar correo a seleccionados (N)» del listado de Clientes abre el diálogo.
describe('Listado de Clientes · Enviar correo a seleccionados', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.empresaActivaId = 'e-1'
    mocks.rpc.mockResolvedValue({ data: 'campana-1', error: null })
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.usePuedeAccion.mockReturnValue({ puede: false, isLoading: false })
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: false, isLoading: false })
    mocks.useBuscarClientes.mockReturnValue({
      clientes: [cliente(1), cliente(2), cliente(3)], total: 3, isLoading: false, isFetching: false, isError: false, refetch: mocks.refetch,
    })
  })

  it('sin selección avisa «Elegí al menos un cliente con las casillas» y no abre el diálogo', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar correo a seleccionados' }))
    expect(await screen.findByText('Elegí al menos un cliente con las casillas')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('con N marcados el botón dice «(N)» y abre el diálogo con esos N', () => {
    abrir()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Cliente 1' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Cliente 3' }))
    fireEvent.click(screen.getByRole('button', { name: 'Enviar correo a seleccionados (2)' }))
    expect(screen.getByRole('dialog', { name: 'Enviar correo a seleccionados' })).toBeInTheDocument()
    expect(screen.getByText(/Se envía a los 2 clientes marcados en el listado/)).toBeInTheDocument()
  })

  it('«Enviar correo» crea la campaña solo con los marcados y la empresa activa', async () => {
    abrir()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Cliente 1' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Cliente 3' }))
    fireEvent.click(screen.getByRole('button', { name: 'Enviar correo a seleccionados (2)' }))
    fireEvent.change(screen.getByLabelText(/Asunto/), { target: { value: 'Ofertas' } })
    fireEvent.change(screen.getByLabelText(/Mensaje/), { target: { value: 'Hola' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar correo' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1))
    expect(mocks.rpc).toHaveBeenCalledWith('crear_campana_correo', expect.objectContaining({
      p_asunto: 'Ofertas', p_mensaje: 'Hola', p_empresa: 'e-1', p_clientes: ['c-1', 'c-3'],
    }))
    expect(await screen.findByText(/Campaña creada/)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Enviar correo a seleccionados' })).toBeInTheDocument()
  })

  it('«Cancelar» cierra el diálogo sin enviar nada', () => {
    abrir()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Cliente 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Enviar correo a seleccionados (1)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(mocks.rpc).not.toHaveBeenCalled()
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
