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
vi.mock('../../hooks/useBanderaListasPrecios', () => ({ useBanderaListasPrecios: () => ({ activa: true, cargando: false, hayError: false }) }))
vi.mock('../../hooks/useListasPreciosActivas', () => ({
  useListasPreciosActivas: () => ({
    listas: [{ id: 'l-1', nombre: 'Revendedores', descripcion: null, ajustePct: -20, archivadaEn: null, clientesAsignados: 0, actualizadoEn: 't' }],
    cargando: false,
    hayError: false,
  }),
}))
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

const elegirLista = async (dialogo: HTMLElement) => {
  fireEvent.mouseDown(within(dialogo).getByRole('combobox', { name: 'Lista de precios' }))
  fireEvent.click(await screen.findByRole('option', { name: 'Revendedores (-20 %)' }))
}

describe('Listado de Clientes · Asignar lista de precios', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.empresaActivaId = 'e-1'
    mocks.rpc.mockResolvedValue({ data: [{ asignados: 2, sin_cambios: 0, omitidos: 0 }], error: null })
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
    expect(screen.queryByRole('button', { name: /Asignar lista de precios/ })).not.toBeInTheDocument()
  })

  it('no pide listas ni bandera mientras el diálogo está cerrado', () => {
    abrir()
    expect(screen.getByRole('button', { name: 'Asignar lista de precios' })).toBeEnabled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('sin clientes en el listado ni marcados el botón está deshabilitado', () => {
    mocks.useBuscarClientes.mockReturnValue({ clientes: [], total: 0, isLoading: false, isFetching: false, isError: false, refetch: mocks.refetch })
    abrir()
    expect(screen.getByRole('button', { name: 'Asignar lista de precios' })).toBeDisabled()
  })

  it('asigna la lista a los marcados, avisa el resultado, descarta la selección y recarga', async () => {
    abrir()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Cliente 1' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Cliente 3' }))
    fireEvent.click(screen.getByRole('button', { name: 'Asignar lista de precios (2)' }))
    const dialogo = screen.getByRole('dialog', { name: 'Asignar lista de precios' })
    await elegirLista(dialogo)
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Asignar a 2' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('asignar_lista_precios_masiva', {
      p_lista: 'l-1', p_clientes: ['c-1', 'c-3'], p_texto: null, p_tipo: null, p_empresa_id: null, p_con_cuenta_web: false,
    }))
    expect(await screen.findByText('Lista «Revendedores» asignada a 2 clientes.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.refetch).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Asignar lista de precios' })).toBeEnabled()
    expect(screen.getByRole('checkbox', { name: 'Seleccionar Cliente 1' })).not.toBeChecked()
  })

  it('sin marcados ofrece todos los que coinciden con los filtros del listado', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Mayorista' }))
    fireEvent.click(screen.getByRole('button', { name: 'Asignar lista de precios' }))
    const dialogo = screen.getByRole('dialog', { name: 'Asignar lista de precios' })
    expect(within(dialogo).getByRole('radio', { name: 'Todos los que coinciden con la búsqueda y los filtros (3)' })).toBeChecked()
    await elegirLista(dialogo)
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Asignar a 3' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('asignar_lista_precios_masiva', {
      p_lista: 'l-1', p_clientes: null, p_texto: null, p_tipo: 'mayorista', p_empresa_id: 'e-1', p_con_cuenta_web: false,
    }))
  })

  it('con archivados a la vista y sin marcados el botón está deshabilitado (el filtro no los alcanza)', () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Archivados' }))
    expect(screen.getByRole('button', { name: 'Asignar lista de precios' })).toBeDisabled()
  })

  it('si la base rechaza lo dice en castellano y deja el diálogo abierto', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'texto interno' } })
    abrir()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Cliente 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Asignar lista de precios (1)' }))
    const dialogo = screen.getByRole('dialog', { name: 'Asignar lista de precios' })
    await elegirLista(dialogo)
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Asignar a 1' }))
    expect(await screen.findByText('Solo un administrador puede cambiar las listas de precios.')).toBeInTheDocument()
    expect(screen.queryByText('texto interno')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Asignar lista de precios' })).toBeInTheDocument()
  })

  it('al cambiar de empresa cierra el diálogo sin enviar y descarta la selección', async () => {
    const vista = abrir()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Cliente 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Asignar lista de precios (1)' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    mocks.empresaActivaId = 'e-2'
    await act(async () => { vista.rerender(<MemoryRouter initialEntries={['/clientes']}><ClienteList /></MemoryRouter>) })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(await screen.findByText(/Cambiaste de empresa: se cerró «Asignar lista de precios»/)).toBeInTheDocument()
  })

  it.each([320, 768, 1440])('el diálogo no tiene violaciones de accesibilidad a %i px', async (ancho) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: ancho })
    abrir()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Cliente 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Asignar lista de precios (1)' }))
    expect(await violacionesAxe(screen.getByRole('dialog'))).toEqual([])
  })
})
