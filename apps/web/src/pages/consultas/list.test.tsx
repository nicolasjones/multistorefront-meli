import { useState } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useBandejaConsultas: vi.fn(),
  useConsulta: vi.fn(),
  useConsultasNuevas: vi.fn(),
  useResponsablesConsultas: vi.fn(),
  useNivelSeccion: vi.fn(),
  useRespuestasRapidas: vi.fn(),
  useFiltroPorEmpresaActiva: vi.fn(),
  refetch: vi.fn(),
  refetchDetalle: vi.fn(),
}))

vi.mock('../../hooks/useConsultas', () => ({
  useBandejaConsultas: mocks.useBandejaConsultas,
  useConsulta: mocks.useConsulta,
  useConsultasNuevas: mocks.useConsultasNuevas,
  useResponsablesConsultas: mocks.useResponsablesConsultas,
}))
vi.mock('../../hooks/useRespuestasRapidas', () => ({ useRespuestasRapidas: mocks.useRespuestasRapidas }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: mocks.useFiltroPorEmpresaActiva }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import type { Consulta } from '../../lib/consultas'
import { ConsultaList } from './list'

const ID_CONSULTA = 'c1000000-0000-0000-0000-000000000001'

const consulta = (extra: Partial<Consulta> = {}): Consulta => ({
  id: ID_CONSULTA,
  empresa_id: 'e-1',
  empresa_nombre: 'San Javucho',
  origen: 'formulario',
  nombre: 'Ana Pérez',
  contacto: 'ana@example.com',
  mensaje: 'Hola, ¿tienen stock?',
  producto_id: null,
  producto_nombre: null,
  estado: 'nueva',
  responsable_id: null,
  responsable_nombre: null,
  nota_interna: null,
  created_at: '2026-10-23T11:48:00.000Z',
  updated_at: '2026-10-23T11:48:00.000Z',
  ...extra,
})

const bandeja = (filas: Consulta[], extra: Record<string, unknown> = {}) => ({
  consultas: filas,
  total: filas.length,
  isLoading: false,
  isFetching: false,
  isError: false,
  refetch: mocks.refetch,
  ...extra,
})

const detalle = (fila: Consulta | null, extra: Record<string, unknown> = {}) => ({
  consulta: fila,
  isLoading: false,
  isError: false,
  noEncontrada: fila === null,
  refetch: mocks.refetchDetalle,
  ...extra,
})

const empresas = [
  { id: 'e-1', nombre: 'San Javucho' },
  { id: 'e-2', nombre: 'Mundo JC' },
]

const estadoFiltro = {
  empresaActivaId: null as string | null,
  cargando: false,
  hayError: false,
}

const abrir = (ruta = '/consultas') =>
  render(<MemoryRouter initialEntries={[ruta]}><ConsultaList /></MemoryRouter>)

const ultimosFiltros = () => mocks.useBandejaConsultas.mock.calls.at(-1)![0]

describe('ConsultaList (F-CON-01, FR-006)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.useConsultasNuevas.mockReturnValue({ total: 3 })
    mocks.useResponsablesConsultas.mockReturnValue({ responsables: [], isLoading: false, isError: false })
    mocks.useRespuestasRapidas.mockReturnValue({ respuestas: [], isLoading: false, isError: false, refetch: vi.fn() })
    mocks.useBandejaConsultas.mockReturnValue(bandeja([consulta()]))
    mocks.useConsulta.mockImplementation((id: string | null) => detalle(id === ID_CONSULTA ? consulta() : null))
    estadoFiltro.empresaActivaId = null
    estadoFiltro.cargando = false
    estadoFiltro.hayError = false
    mocks.useFiltroPorEmpresaActiva.mockImplementation(() => {
      const [sobrescritura, setSobrescritura] = useState<{ base: string | null; valor: string | null } | null>(null)
      const valor = sobrescritura && sobrescritura.base === estadoFiltro.empresaActivaId
        ? sobrescritura.valor
        : estadoFiltro.empresaActivaId
      return {
        empresas,
        valor,
        cambiar: (id: string | null) => setSobrescritura({ base: estadoFiltro.empresaActivaId, valor: id }),
        empresaActivaId: estadoFiltro.empresaActivaId,
        cargando: estadoFiltro.cargando,
        hayError: estadoFiltro.hayError,
      }
    })
  })

  afterEach(() => vi.useRealTimers())

  it('muestra título, subtítulo, aviso, fila Tienda y las columnas del prototipo', () => {
    abrir()
    expect(screen.getByRole('heading', { name: 'Consultas', level: 1 })).toBeInTheDocument()
    expect(screen.getByText(/Mensajes del formulario de contacto de las tiendas/)).toBeInTheDocument()
    expect(screen.getByText(/envía un aviso por correo a la dirección de avisos de la empresa/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Todas las tiendas' })).toBeInTheDocument()
    expect(screen.getByText(/Si elegís una empresa en la barra superior, se filtra por esa tienda/)).toBeInTheDocument()
    for (const nombre of ['Estado', 'Cuándo', 'Empresa', 'Contacto', 'Producto', 'Origen']) {
      expect(screen.getByRole('columnheader', { name: nombre })).toBeInTheDocument()
    }
  })

  it('lista la consulta con estado, empresa, contacto, producto y origen, y muestra el pie «N consultas»', () => {
    mocks.useBandejaConsultas.mockReturnValue(bandeja([consulta(), consulta({ id: 'otra', nombre: 'Carlos', contacto: 'carlos@example.com', producto_nombre: 'Funda', origen: 'whatsapp', estado: 'resuelta' })], { total: 2 }))
    abrir()
    const tabla = within(screen.getByRole('table', { name: 'Consultas' }))
    expect(tabla.getByText('Ana Pérez')).toBeInTheDocument()
    expect(tabla.getByText('ana@example.com')).toBeInTheDocument()
    expect(tabla.getByText('Sin producto')).toBeInTheDocument()
    expect(tabla.getByText('Funda')).toBeInTheDocument()
    expect(tabla.getByText('Formulario')).toBeInTheDocument()
    expect(tabla.getByText('WhatsApp')).toBeInTheDocument()
    expect(tabla.getByText('Nueva')).toBeInTheDocument()
    expect(tabla.getByText('Resuelta')).toBeInTheDocument()
    expect(screen.getAllByText('2 consultas').length).toBeGreaterThan(0)
  })

  it('singulariza el pie con una consulta', () => {
    abrir()
    expect(screen.getAllByText('1 consulta').length).toBeGreaterThan(0)
  })

  it('busca por nombre, producto o mensaje después de la pausa de tipeo y vuelve a la página 1', () => {
    vi.useFakeTimers()
    mocks.useBandejaConsultas.mockReturnValue(bandeja([consulta()], { total: 60 }))
    abrir()
    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente/i, hidden: true }))
    expect(ultimosFiltros().pagina).toBe(2)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar consultas' }), { target: { value: '  ana, (pérez)  ' } })
    act(() => { vi.advanceTimersByTime(300) })
    expect(ultimosFiltros()).toMatchObject({ texto: '  ana, (pérez)  ', pagina: 1 })
  })

  it('filtra por estado con los chips de la épica (Todas, Nuevas (n), En curso, Resuelta)', () => {
    abrir()
    expect(screen.getByRole('button', { name: 'Nuevas (3)' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'En curso' }))
    expect(ultimosFiltros()).toMatchObject({ estado: 'en_curso', pagina: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Resuelta' }))
    expect(ultimosFiltros()).toMatchObject({ estado: 'resuelta', pagina: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Todas' }))
    expect(ultimosFiltros()).toMatchObject({ estado: null, pagina: 1 })
  })

  it('filtra por rango de fechas y reinicia la paginación', () => {
    abrir()
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-10-23' } })
    expect(ultimosFiltros()).toMatchObject({ desde: '2026-10-01', hasta: '2026-10-23', pagina: 1 })
  })

  it('filtra por tienda desde la fila Tienda', () => {
    abrir()
    expect(ultimosFiltros()).toMatchObject({ empresaId: null })
    fireEvent.click(screen.getByRole('button', { name: 'Mundo JC' }))
    expect(ultimosFiltros()).toMatchObject({ empresaId: 'e-2', pagina: 1 })
  })

  it('con una empresa concreta en la barra superior filtra por ella', () => {
    estadoFiltro.empresaActivaId = 'e-1'
    abrir()
    expect(ultimosFiltros()).toMatchObject({ empresaId: 'e-1' })
  })

  it('pagina en el servidor y reencuadra la página al cambiar un filtro', () => {
    mocks.useBandejaConsultas.mockReturnValue(bandeja([consulta()], { total: 60 }))
    abrir()
    expect(screen.getByText('1–25 de 60')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente/i, hidden: true }))
    expect(ultimosFiltros().pagina).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: 'Resuelta' }))
    expect(ultimosFiltros().pagina).toBe(1)
  })

  it('sin consultas ni filtros muestra el vacío inicial; con filtros, «sin resultados»', () => {
    mocks.useBandejaConsultas.mockReturnValue(bandeja([]))
    abrir()
    expect(screen.getByText('Todavía no hay consultas.')).toBeInTheDocument()
    expect(screen.queryByText('Sin resultados para el filtro.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Resuelta' }))
    expect(screen.getByText('Sin resultados para el filtro.')).toBeInTheDocument()
  })

  it('muestra la carga y el error con reintento', () => {
    mocks.useBandejaConsultas.mockReturnValue(bandeja([], { isLoading: true }))
    const { unmount } = abrir()
    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
    unmount()
    mocks.useBandejaConsultas.mockReturnValue(bandeja([], { isError: true }))
    abrir()
    expect(screen.getByText('No pudimos cargar las consultas.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(mocks.refetch).toHaveBeenCalledTimes(1)
  })

  it('abrir la fila carga el detalle y deja `?consulta=<id>` en la URL', () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir la consulta de Ana Pérez' }))
    expect(mocks.useConsulta).toHaveBeenLastCalledWith(ID_CONSULTA)
    expect(screen.getByText('Consulta de Ana Pérez')).toBeInTheDocument()
  })

  it('el enlace `?consulta=<id>` abre directo el detalle', () => {
    abrir(`/consultas?consulta=${ID_CONSULTA}`)
    expect(mocks.useConsulta).toHaveBeenCalledWith(ID_CONSULTA)
    expect(screen.getByText('Consulta de Ana Pérez')).toBeInTheDocument()
  })

  it('un `?consulta=` que no es un id válido se ignora y no revela nada', () => {
    abrir('/consultas?consulta=no-es-un-id')
    expect(mocks.useConsulta).toHaveBeenLastCalledWith(null)
    expect(screen.queryByText(/^Consulta de /)).not.toBeInTheDocument()
  })

  it('cambiar la empresa activa recarga, vuelve a la página 1 y cierra el detalle abierto', () => {
    vi.useFakeTimers()
    mocks.useBandejaConsultas.mockReturnValue(bandeja([consulta()], { total: 60 }))
    const { rerender } = render(
      <MemoryRouter initialEntries={[`/consultas?consulta=${ID_CONSULTA}`]}>
        <ConsultaList />
      </MemoryRouter>,
    )
    expect(screen.getByText('Consulta de Ana Pérez')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente/i, hidden: true }))
    expect(ultimosFiltros().pagina).toBe(2)

    estadoFiltro.empresaActivaId = 'e-2'
    rerender(
      <MemoryRouter initialEntries={[`/consultas?consulta=${ID_CONSULTA}`]}>
        <ConsultaList />
      </MemoryRouter>,
    )
    expect(screen.queryByText('Consulta de Ana Pérez')).not.toBeInTheDocument()
    expect(ultimosFiltros()).toMatchObject({ empresaId: 'e-2', pagina: 1 })
  })

  it('Respuestas rápidas: el botón abre el diálogo de la empresa activa y al cambiar de empresa se cierra con aviso (FR-018)', () => {
    estadoFiltro.empresaActivaId = 'e-1'
    const { rerender } = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Respuestas rápidas' }))
    expect(screen.getByText('Respuestas rápidas · San Javucho')).toBeInTheDocument()
    expect(mocks.useRespuestasRapidas).toHaveBeenLastCalledWith('e-1')

    estadoFiltro.empresaActivaId = 'e-2'
    rerender(<MemoryRouter initialEntries={['/consultas']}><ConsultaList /></MemoryRouter>)
    expect(screen.queryByText('Respuestas rápidas · San Javucho')).not.toBeInTheDocument()
    expect(screen.getByText(/Cambió la empresa activa: se cerró «Respuestas rápidas»/)).toBeInTheDocument()
  })
})
