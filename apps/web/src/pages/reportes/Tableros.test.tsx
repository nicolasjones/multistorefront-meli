import { act, fireEvent, render, screen } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  usePuedeEscribir: vi.fn(),
  useReportesAsignados: vi.fn(),
  useFiltroPorEmpresaActiva: vi.fn(),
  montajes: vi.fn(),
  propsReporte: { current: null as null | { reporteId: string; urlParams?: Record<string, string>; alFallar?: (motivo: 'prohibido' | 'no_disponible') => void } },
}))
vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: mocks.usePuedeEscribir }))
vi.mock('../../hooks/useReportesAsignados', () => ({ useReportesAsignados: mocks.useReportesAsignados }))
vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: mocks.useFiltroPorEmpresaActiva }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: { auth: { getUser: async () => ({ data: { user: null } }) } } }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => <span>Organización: Uno</span> }))
vi.mock('../acceso-restringido/AccesoRestringido', () => ({
  AccesoRestringido: ({ seccion }: { seccion: string }) => <div>Acceso restringido a {seccion}</div>,
}))
// El tablero real monta un iframe de Superset y pide el token del guest: acá se cuenta cada montaje (un montaje = un pedido de token).
vi.mock('../../components/ReporteEmbebido', async () => {
  const { useEffect } = await import('react')
  return {
    ReporteEmbebido: (props: { reporteId: string; urlParams?: Record<string, string>; alFallar?: (motivo: 'prohibido' | 'no_disponible') => void }) => {
      mocks.propsReporte.current = props
      useEffect(() => { mocks.montajes(props.reporteId, props.urlParams) }, [props.reporteId, props.urlParams])
      return <div data-testid="tablero">Tablero {props.reporteId}</div>
    },
  }
})

import { TablerosAnaliticos } from './Tableros'

const REPORTES = [
  { id: 'rep-ventas', nombre: 'Analítica · Ventas por tienda y categoría' },
  { id: 'rep-margen', nombre: 'Analítica · Margen real por tienda, categoría y producto' },
  { id: 'rep-otro', nombre: 'Un reporte que no es de la galería' },
]
const EMPRESAS = [
  { id: 'e-a', nombre: 'Tienda A', activa: true },
  { id: 'e-b', nombre: 'Tienda B', activa: true },
]
const filtroEmpresa = (valor: string | null, extra: Record<string, unknown> = {}) => ({
  empresas: EMPRESAS, valor, cambiar: vi.fn(), cargando: false, hayError: false, empresaActivaId: valor, ...extra,
})

// matchMedia que evalúa `max-width` / `min-width` contra un ancho de ventana simulado.
function simularAncho(ancho: number) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const max = /max-width:\s*([\d.]+)px/.exec(query)
    const min = /min-width:\s*([\d.]+)px/.exec(query)
    const matches = (!max || ancho <= Number(max[1])) && (!min || ancho >= Number(min[1]))
    return { matches, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }
  }) as unknown as typeof window.matchMedia
}

const abrir = (titulo: string) => fireEvent.click(screen.getByRole('button', { name: `Abrir el tablero ${titulo}` }))

describe('Tableros analíticos (F-REP-07)', () => {
  const matchMediaOriginal = window.matchMedia
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.propsReporte.current = null
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: true, isLoading: false })
    mocks.useReportesAsignados.mockReturnValue({ reportes: REPORTES, isLoading: false })
    mocks.useFiltroPorEmpresaActiva.mockReturnValue(filtroEmpresa(null))
    simularAncho(1440)
  })
  afterEach(() => { window.matchMedia = matchMediaOriginal })

  it('RF-REP-07-1: la galería muestra solo los tableros del catálogo asignados, con sus cruces y filtros', () => {
    render(<TablerosAnaliticos />)
    expect(screen.getByRole('heading', { level: 1, name: 'Tableros analíticos' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Ventas por tienda y categoría' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Margen real por tienda, categoría y producto' })).toBeInTheDocument()
    expect(screen.getByText('Tienda × categoría · Período × categoría · Producto × tienda')).toBeInTheDocument()
    expect(screen.getByText('Período · Tienda · Categoría · Estado del margen · Agrupar por día, semana o mes')).toBeInTheDocument()
    // El reporte visible que no está en el catálogo no se ofrece; el que no está asignado tampoco.
    expect(screen.queryByText(/no es de la galería/)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Productos más vendidos' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Abrir el tablero/ })).toHaveLength(2)
    expect(screen.getByText(/Incluye costo y margen/)).toBeInTheDocument()
    // Nada de armar o editar tableros: la galería solo elige.
    expect(screen.queryByRole('button', { name: /crear|editar|guardar/i })).not.toBeInTheDocument()
    expect(mocks.montajes).not.toHaveBeenCalled()
  })

  it('sin tableros asignados muestra el estado vacío', () => {
    mocks.useReportesAsignados.mockReturnValue({ reportes: [{ id: 'x', nombre: 'Otro' }], isLoading: false })
    render(<TablerosAnaliticos />)
    expect(screen.getByText('Todavía no hay tableros disponibles para tu organización.')).toBeInTheDocument()
  })

  it('mientras carga muestra el estado de carga y no consulta tableros', () => {
    mocks.useReportesAsignados.mockReturnValue({ reportes: [], isLoading: true })
    render(<TablerosAnaliticos />)
    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
  })

  it('quien no es administrador ve el acceso restringido y no se pide ningún token', () => {
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: false, isLoading: false })
    render(<TablerosAnaliticos />)
    expect(screen.getByText('Acceso restringido a Tableros analíticos')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Abrir el tablero/ })).not.toBeInTheDocument()
    expect(mocks.montajes).not.toHaveBeenCalled()
  })

  it('RF-REP-07-2: abrir un tablero lo monta embebido con el período preseleccionado (sin entrar a Superset)', () => {
    render(<TablerosAnaliticos />)
    abrir('Ventas por tienda y categoría')
    expect(screen.getByTestId('tablero')).toHaveTextContent('rep-ventas')
    expect(mocks.montajes).toHaveBeenCalledTimes(1)
    const urlParams = mocks.propsReporte.current?.urlParams
    expect(urlParams?.native_filters).toContain('NATIVE_FILTER-rango')
    // Todas las tiendas: no se preselecciona ninguna.
    expect(urlParams?.native_filters).not.toContain('NATIVE_FILTER-empresa')
    expect(screen.getByRole('button', { name: 'Volver a los tableros' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Volver a los tableros' }))
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Abrir el tablero/ })).toHaveLength(2)
  })

  it('RF-REP-07-3 (empresa activa): con una tienda elegida se preselecciona; al cambiarla el tablero se vuelve a montar con la nueva', () => {
    mocks.useFiltroPorEmpresaActiva.mockReturnValue(filtroEmpresa('e-a'))
    const { rerender } = render(<TablerosAnaliticos />)
    abrir('Ventas por tienda y categoría')
    expect(mocks.montajes).toHaveBeenCalledTimes(1)
    expect(mocks.propsReporte.current?.urlParams?.native_filters).toContain("'Tienda A'")

    mocks.useFiltroPorEmpresaActiva.mockReturnValue(filtroEmpresa('e-b'))
    rerender(<TablerosAnaliticos />)
    expect(mocks.montajes).toHaveBeenCalledTimes(2)
    const filtros = mocks.propsReporte.current?.urlParams?.native_filters ?? ''
    expect(filtros).toContain("'Tienda B'")
    expect(filtros).not.toContain("'Tienda A'")
  })

  it('no monta el tablero hasta conocer la tienda (un solo pedido de token)', () => {
    mocks.useFiltroPorEmpresaActiva.mockReturnValue(filtroEmpresa(null, { cargando: true, empresas: [] }))
    render(<TablerosAnaliticos />)
    abrir('Ventas por tienda y categoría')
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()
    expect(mocks.montajes).not.toHaveBeenCalled()
  })

  it('un tablero que no se puede cargar muestra el error con «Reintentar», que vuelve a montarlo', () => {
    render(<TablerosAnaliticos />)
    abrir('Ventas por tienda y categoría')
    act(() => { mocks.propsReporte.current?.alFallar?.('no_disponible') })
    expect(screen.getByText('No pudimos cargar el tablero «Ventas por tienda y categoría».')).toBeInTheDocument()
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(screen.getByTestId('tablero')).toBeInTheDocument()
    expect(mocks.montajes).toHaveBeenCalledTimes(2)
  })

  it('un 403 del token (sin acceso al tablero) muestra el acceso restringido', () => {
    render(<TablerosAnaliticos />)
    abrir('Margen real por tienda, categoría y producto')
    act(() => { mocks.propsReporte.current?.alFallar?.('prohibido') })
    expect(screen.getByText('Acceso restringido a Margen real por tienda, categoría y producto')).toBeInTheDocument()
  })

  it.each([320, 768, 1440])('accesibilidad a %i px: la galería y el tablero abierto no tienen violaciones de axe y se operan con teclado', async (ancho) => {
    simularAncho(ancho)
    const { container } = render(<TablerosAnaliticos />)
    const opciones = { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } }
    expect((await axe.run(container, opciones)).violations.map((v) => v.id)).toEqual([])
    const boton = screen.getByRole('button', { name: 'Abrir el tablero Ventas por tienda y categoría' })
    boton.focus()
    expect(boton).toHaveFocus()
    fireEvent.click(boton)
    expect((await axe.run(container, opciones)).violations.map((v) => v.id)).toEqual([])
  })
})
