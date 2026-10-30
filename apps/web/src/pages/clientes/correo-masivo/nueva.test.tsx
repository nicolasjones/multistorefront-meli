import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useDestinatarios: vi.fn(),
  useNivelSeccion: vi.fn(),
  useFiltroPorEmpresaActiva: vi.fn(),
  elegirEmpresa: vi.fn(),
  refetch: vi.fn(),
}))

vi.mock('../../../hooks/useDestinatariosCorreoMasivo', () => ({ useDestinatariosCorreoMasivo: mocks.useDestinatarios }))
vi.mock('../../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: mocks.useFiltroPorEmpresaActiva }))
vi.mock('../../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { CorreoMasivoNueva } from './nueva'

const filaDestinatario = (n: number) => ({ id: `c-${n}`, numero: n, nombre: `Cliente ${n}`, correo: `c${n}@example.com` })
const respuesta = (filas = [filaDestinatario(1), filaDestinatario(2)], extra: Record<string, unknown> = {}) => ({
  filas, total: filas.length, resumen: { elegibles: filas.length, sin_correo: 3, no_aceptan: 1 },
  isLoading: false, isFetching: false, isError: false, refetch: mocks.refetch, ...extra,
})
const ultimosFiltros = () => mocks.useDestinatarios.mock.calls.at(-1)![0]
const abrir = (state?: unknown) => render(
  <MemoryRouter initialEntries={[{ pathname: '/clientes/correo-masivo', state }]}><CorreoMasivoNueva /></MemoryRouter>,
)

describe('Correo masivo · Nueva campaña', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.useDestinatarios.mockReturnValue(respuesta())
    mocks.useFiltroPorEmpresaActiva.mockReturnValue({
      empresas: [{ id: 'e-1', nombre: 'San Javucho' }, { id: 'e-2', nombre: 'Mundo JC' }],
      valor: null, cambiar: mocks.elegirEmpresa, empresaActivaId: null, cargando: false, hayError: false,
    })
  })
  afterEach(() => vi.useRealTimers())

  it('lista los destinatarios con su conteo y dice cuántos quedan afuera y por qué', () => {
    abrir()
    expect(screen.getByRole('heading', { name: 'Correo masivo' })).toBeInTheDocument()
    expect(screen.getAllByText('Cliente 1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('c2@example.com').length).toBeGreaterThan(0)
    expect(screen.getByText('2 destinatarios')).toBeInTheDocument()
    expect(screen.getByText('Quedan afuera: 3 sin correo y 1 no acepta el correo masivo.')).toBeInTheDocument()
  })

  it('FR-003: la búsqueda, el tipo, la empresa y «con cuenta web» recalculan lista y conteo', () => {
    abrir()
    expect(ultimosFiltros()).toMatchObject({ texto: '', tipo: null, empresaId: null, conCuentaWeb: false, clientes: null, pagina: 1 })

    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar clientes' }), { target: { value: 'ana' } })
    act(() => { vi.advanceTimersByTime(350) })
    expect(ultimosFiltros()).toMatchObject({ texto: 'ana' })

    fireEvent.click(screen.getByRole('button', { name: 'Mayorista' }))
    expect(ultimosFiltros()).toMatchObject({ tipo: 'mayorista' })

    fireEvent.click(screen.getByRole('button', { name: 'Con cuenta web' }))
    expect(ultimosFiltros()).toMatchObject({ conCuentaWeb: true })

    fireEvent.click(screen.getByRole('button', { name: 'Mundo JC' }))
    expect(mocks.elegirEmpresa).toHaveBeenCalledWith('e-2')
  })

  it('usa FiltroEmpresa: «Todas las tiendas» y una píldora por empresa', () => {
    abrir()
    expect(screen.getByRole('button', { name: 'Todas las tiendas' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'San Javucho' })).toBeInTheDocument()
  })

  it('con clientes marcados en el listado restringe el grupo a ellos y permite quitar la selección', () => {
    abrir({ clientes: ['c-1', 'c-9'], empresaActivaId: null })
    expect(ultimosFiltros()).toMatchObject({ clientes: ['c-1', 'c-9'] })
    expect(screen.getByText('Solo los 2 clientes marcados en el listado.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Quitar selección' }))
    expect(ultimosFiltros()).toMatchObject({ clientes: null })
    expect(screen.queryByText(/clientes marcados en el listado/)).not.toBeInTheDocument()
  })

  it('sin destinatarios muestra el estado vacío; con error, el reintento', () => {
    mocks.useDestinatarios.mockReturnValue(respuesta([]))
    const { unmount } = abrir()
    expect(screen.getByText('Todavía no hay clientes que acepten el correo masivo.')).toBeInTheDocument()
    unmount()

    mocks.useDestinatarios.mockReturnValue(respuesta([], { isError: true }))
    abrir()
    expect(screen.getByText('No pudimos cargar los destinatarios.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }))
    expect(mocks.refetch).toHaveBeenCalled()
  })

  it('mientras carga muestra el estado de carga y no la lista', () => {
    mocks.useDestinatarios.mockReturnValue(respuesta([filaDestinatario(1)], { isLoading: true }))
    abrir()
    expect(screen.queryByText('Cliente 1')).not.toBeInTheDocument()
  })

  it('FR-006: sin edición en Clientes no se puede armar el grupo', () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    abrir()
    expect(screen.getByText('Tu rol no puede armar el correo masivo.')).toBeInTheDocument()
    expect(screen.queryByText('Cliente 1')).not.toBeInTheDocument()
  })
})
