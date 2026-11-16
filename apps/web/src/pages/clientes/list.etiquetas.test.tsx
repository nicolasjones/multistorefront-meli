import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ estado: { empresaActiva: 'e-1' as string | null }, useBuscarClientes: vi.fn(), refetch: vi.fn() }))

vi.mock('@refinedev/mui', () => ({ CreateButton: () => <button type="button">Nuevo cliente</button> }))
vi.mock('../../hooks/useBuscarClientes', () => ({ useBuscarClientes: mocks.useBuscarClientes }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: () => ({ nivel: 'edicion' }) }))
vi.mock('../../hooks/usePuedeAccion', () => ({ usePuedeAccion: () => ({ puede: false }) }))
vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: () => ({ puedeEscribir: false }) }))
vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({
  useFiltroPorEmpresaActiva: () => ({
    empresas: [{ id: 'e-1', nombre: 'San Javucho' }, { id: 'e-2', nombre: 'Mundo JC' }],
    valor: mocks.estado.empresaActiva, cambiar: vi.fn(), empresaActivaId: mocks.estado.empresaActiva, cargando: false, hayError: false,
  }),
}))
vi.mock('../../components/clientes/ExportarClientes', () => ({ ExportarClientes: () => null }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import type { ClienteListado } from '../../hooks/useBuscarClientes'
import { ClienteList } from './list'

const cliente = (n: number): ClienteListado => ({
  id: `c-${n}`, numero: n, nombre: `Cliente ${n}`, documento: null, correo: null, telefono: null, celular: null, localidad: null,
  expreso_preferido: null, tipo: 'minorista', es_consumidor_final: false, archivado_en: null, empresas: [], cuentas_web: [],
})

const Hoja = () => <div>Hoja {useLocation().search}</div>
const arbol = () => (
  <MemoryRouter>
    <Routes>
      <Route path="/" element={<ClienteList />} />
      <Route path="/clientes/etiquetas" element={<Hoja />} />
    </Routes>
  </MemoryRouter>
)

describe('listado de clientes: imprimir etiquetas (F-CLI-17, FR-004)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.estado.empresaActiva = 'e-1'
    mocks.useBuscarClientes.mockReturnValue({
      clientes: [cliente(1), cliente(2)], total: 2, isLoading: false, isFetching: false, isError: false, refetch: mocks.refetch,
    })
  })

  it('«Imprimir etiquetas» está deshabilitado sin selección y abre la hoja con los marcados', () => {
    render(arbol())
    expect(screen.getByRole('button', { name: 'Imprimir etiquetas' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Cliente 1' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Cliente 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir etiquetas (2)' }))
    expect(screen.getByText('Hoja ?ids=c-1,c-2')).toBeInTheDocument()
  })

  it('al cambiar de empresa descarta la selección, reencuadra la página y recarga', async () => {
    const { rerender } = render(arbol())
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Cliente 1' }))
    expect(screen.getByRole('button', { name: 'Imprimir etiquetas (1)' })).toBeEnabled()
    mocks.estado.empresaActiva = 'e-2'
    rerender(arbol())
    await waitFor(() => expect(mocks.useBuscarClientes.mock.calls.at(-1)![0]).toMatchObject({ empresaId: 'e-2', pagina: 1 }))
    expect(screen.getByRole('checkbox', { name: 'Seleccionar Cliente 1' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Imprimir etiquetas' })).toBeDisabled()
  })
})
