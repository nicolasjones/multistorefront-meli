import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  estado: { empresaActiva: 'e-1' as string | null },
  useBuscarClientes: vi.fn(),
  useDestinatarios: vi.fn(),
  useNivelSeccion: vi.fn(),
  usePuedeAccion: vi.fn(),
  usePuedeEscribir: vi.fn(),
  refetch: vi.fn(),
  elegirEmpresa: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

vi.mock('@refinedev/mui', () => ({ CreateButton: () => <button type="button">Nuevo cliente</button> }))
vi.mock('../../../hooks/useBuscarClientes', () => ({ useBuscarClientes: mocks.useBuscarClientes }))
vi.mock('../../../hooks/useDestinatariosCorreoMasivo', () => ({ useDestinatariosCorreoMasivo: mocks.useDestinatarios }))
vi.mock('../../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../../hooks/usePuedeAccion', () => ({ usePuedeAccion: mocks.usePuedeAccion }))
vi.mock('../../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: mocks.usePuedeEscribir }))
vi.mock('../../../hooks/useFiltroPorEmpresaActiva', () => ({
  useFiltroPorEmpresaActiva: () => ({
    empresas: [{ id: 'e-1', nombre: 'San Javucho' }, { id: 'e-2', nombre: 'Mundo JC' }],
    valor: mocks.estado.empresaActiva,
    cambiar: mocks.elegirEmpresa,
    empresaActivaId: mocks.estado.empresaActiva,
    cargando: false,
    hayError: false,
  }),
}))
vi.mock('../../../components/clientes/ExportarClientes', () => ({ ExportarClientes: () => null }))
vi.mock('../../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import type { ClienteListado } from '../../../hooks/useBuscarClientes'
import { ClienteList } from '../list'
import { CorreoMasivoNueva } from './nueva'

const clienteListado = (n: number): ClienteListado => ({
  id: `c-${n}`, numero: n, nombre: `Cliente ${n}`, documento: null, correo: null, telefono: null, celular: null,
  localidad: null, expreso_preferido: null, tipo: 'minorista', es_consumidor_final: false, archivado_en: null, empresas: [], cuentas_web: [],
})

const rutas = (entrada: string | { pathname: string; state: unknown } = '/clientes') => (
  <MemoryRouter initialEntries={[entrada]}>
    <Routes>
      <Route path="/clientes" element={<ClienteList />} />
      <Route path="/clientes/correo-masivo" element={<CorreoMasivoNueva />} />
    </Routes>
  </MemoryRouter>
)

const destinatariosDe = (empresa: string | null) => ({
  filas: [{ id: `d-${empresa}`, numero: 1, nombre: `Destinatario de ${empresa}`, correo: 'x@example.com' }],
  total: 1, resumen: { elegibles: 1, sin_correo: 0, no_aceptan: 0 }, isLoading: false, isFetching: false, isError: false, refetch: mocks.refetch,
})

// F-CLI-11, FR-007 y SC-002 (Principio VIII): el listado, el acceso a «Correo masivo» y la pantalla siguen la
// empresa activa de la barra superior: al cambiarla recargan, descartan la selección y nunca muestran la anterior.
describe('Correo masivo · empresa activa', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.estado.empresaActiva = 'e-1'
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.usePuedeAccion.mockReturnValue({ puede: false, isLoading: false })
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: false, isLoading: false })
    mocks.useBuscarClientes.mockReturnValue({
      clientes: [clienteListado(1)], total: 1, isLoading: false, isFetching: false, isError: false, refetch: mocks.refetch,
    })
    mocks.useDestinatarios.mockImplementation(({ empresaId }: { empresaId: string | null }) => destinatariosDe(empresaId))
  })

  it('en el listado, al cambiar de empresa se descarta la selección y el botón vuelve a pedir una', async () => {
    const { rerender } = render(rutas())
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Cliente 1' }))
    expect(screen.getByRole('button', { name: 'Enviar correo a seleccionados (1)' })).toBeInTheDocument()

    mocks.estado.empresaActiva = 'e-2'
    rerender(rutas())

    await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar correo a seleccionados' })).toBeInTheDocument())
    expect(screen.getByRole('checkbox', { name: 'Seleccionar Cliente 1' })).not.toBeChecked()
  })

  it('en el listado, un diálogo de correo abierto se cierra con aviso al cambiar de empresa y no envía nada', async () => {
    const { rerender } = render(rutas())
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Cliente 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Enviar correo a seleccionados (1)' }))
    expect(screen.getByRole('dialog', { name: 'Enviar correo a seleccionados' })).toBeInTheDocument()

    mocks.estado.empresaActiva = 'e-2'
    rerender(rutas())

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('Cambiaste de empresa: se cerró el envío de correo y se descartó la selección.')).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('en la pantalla, al cambiar de empresa recarga con la nueva, descarta la selección del listado y no muestra la anterior', async () => {
    const entrada = { pathname: '/clientes/correo-masivo', state: { clientes: ['c-1'], empresaActivaId: 'e-1' } }
    const { rerender } = render(rutas(entrada))

    expect(await screen.findByText('Solo el cliente marcado en el listado.')).toBeInTheDocument()
    expect(mocks.useDestinatarios.mock.calls.at(-1)![0]).toMatchObject({ empresaId: 'e-1', clientes: ['c-1'] })
    expect(screen.getAllByText('Destinatario de e-1').length).toBeGreaterThan(0)

    mocks.estado.empresaActiva = 'e-2'
    rerender(rutas(entrada))

    await waitFor(() => expect(mocks.useDestinatarios.mock.calls.at(-1)![0]).toMatchObject({ empresaId: 'e-2', clientes: null, pagina: 1 }))
    expect(screen.getByText('Cambiaste de empresa: se descartó la selección del listado.')).toBeInTheDocument()
    expect(screen.queryByText('Solo el cliente marcado en el listado.')).not.toBeInTheDocument()
    expect(screen.queryByText('Destinatario de e-1')).not.toBeInTheDocument()
    expect(screen.getAllByText('Destinatario de e-2').length).toBeGreaterThan(0)
  })

  it('en la pantalla, una confirmación de envío abierta se cierra al cambiar de empresa y no crea la campaña', async () => {
    const { rerender } = render(rutas({ pathname: '/clientes/correo-masivo', state: null }))
    fireEvent.change(screen.getByLabelText(/Asunto/), { target: { value: 'Ofertas' } })
    fireEvent.change(screen.getByLabelText(/Mensaje/), { target: { value: 'Hola' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar correo' }))
    expect(await screen.findByRole('dialog', { name: 'Enviar correo' })).toBeInTheDocument()

    mocks.estado.empresaActiva = 'e-2'
    rerender(rutas({ pathname: '/clientes/correo-masivo', state: null }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
