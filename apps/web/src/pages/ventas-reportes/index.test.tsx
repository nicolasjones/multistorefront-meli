import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useReportesAsignados: vi.fn(),
  listarEmpresasSelector: vi.fn(),
  useConteoVentasReporte: vi.fn(),
  useNivelSeccion: vi.fn(),
  useIsSuperadmin: vi.fn(),
  useOrganizacionDeTrabajo: vi.fn(),
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
  montajes: vi.fn(),
  exportar: vi.fn(),
  descargar: vi.fn(),
  propsReporte: {
    current: null as null | {
      reporteId: string
      urlParams?: Record<string, string>
      alFallar?: (motivo: 'prohibido' | 'no_disponible') => void
    },
  },
}))

vi.mock('../../hooks/useReportesAsignados', () => ({ useReportesAsignados: mocks.useReportesAsignados }))
// El selector de empresas es real (con su suscripción al cambio de empresa activa): lo que se
// simula es la respuesta de la base, no el hook.
vi.mock('../../lib/empresaActiva', () => ({
  listarEmpresasSelector: mocks.listarEmpresasSelector,
  cambiarEmpresaActiva: vi.fn(),
  usarTodasLasEmpresas: vi.fn(),
}))
vi.mock('../../hooks/useVentasReportes', () => ({ useConteoVentasReporte: mocks.useConteoVentasReporte }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/useIsSuperadmin', () => ({ useIsSuperadmin: mocks.useIsSuperadmin }))
vi.mock('../../hooks/useOrganizacionDeTrabajo', () => ({ useOrganizacionDeTrabajo: mocks.useOrganizacionDeTrabajo }))
vi.mock('../../hooks/useOrganizacionActiva', () => ({
  useOrganizacionActiva: () => ({ organizacionActiva: { id: 'org-1', nombre: 'Uno' }, isLoading: false }),
}))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({
  ContextoOrganizacionActiva: () => <span>Organización: Uno</span>,
}))
// El tablero real monta un iframe de Superset y pide token: acá se simula el montaje y el fallo.
vi.mock('../../components/ReporteEmbebido', async () => {
  const { useEffect } = await import('react')
  return {
    ReporteEmbebido: (props: {
      reporteId: string
      urlParams?: Record<string, string>
      alFallar?: (motivo: 'prohibido' | 'no_disponible') => void
    }) => {
      mocks.propsReporte.current = props
      useEffect(() => { mocks.montajes(props.reporteId) }, [props.reporteId])
      return <div data-testid="tablero">Tablero {props.reporteId}</div>
    },
  }
})
vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    auth: { getUser: mocks.getUser },
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }) }),
  },
}))
// La exportación a Excel (F-VTA-23, FR-009): se simula el armado del archivo, no la base.
vi.mock('../../lib/exportarRankingVentas', async (original) => ({
  ...(await original<typeof import('../../lib/exportarRankingVentas')>()),
  exportarRankingVentas: mocks.exportar,
}))
vi.mock('../../lib/exportarClientes', async (original) => ({
  ...(await original<typeof import('../../lib/exportarClientes')>()),
  descargarArchivo: mocks.descargar,
}))

import { notificarEmpresaActivaCambiada } from '../../lib/empresaActivaRevision'
import { RequiereAccesoSeccion } from '../../components/RequiereAccesoSeccion'
import { ReportesVentas } from './index'

const REPORTE = { id: 'rep-mas-vendidos', nombre: 'Ventas · Más vendidos' }

const SAN_JAVUCHO = { id: 'e-sj', nombre: 'San Javucho', esActiva: true, rolId: 'administrador' }
const MUNDO_JC = { id: 'e-mjc', nombre: 'Mundo JC', esActiva: false, rolId: null }

// La empresa activa de la barra superior (la que devuelve el selector).
let empresaActivaId = 'e-sj'

const empresasDe = () => [
  { ...SAN_JAVUCHO, esActiva: empresaActivaId === SAN_JAVUCHO.id },
  { ...MUNDO_JC, esActiva: empresaActivaId === MUNDO_JC.id },
]

const montar = ({
  nivel = 'lectura',
  reportes = [REPORTE],
  cargandoReportes = false,
  conteo = 5,
  cargandoConteo = false,
  conSeccion = true,
}: {
  nivel?: string
  reportes?: unknown[]
  cargandoReportes?: boolean
  conteo?: number | null
  cargandoConteo?: boolean
  conSeccion?: boolean
} = {}) => {
  mocks.useReportesAsignados.mockReturnValue({ reportes, isLoading: cargandoReportes })
  // Se resuelve en cada llamada: así el cambio de empresa activa se ve en la respuesta.
  mocks.listarEmpresasSelector.mockImplementation(async () => empresasDe())
  mocks.useConteoVentasReporte.mockReturnValue({
    conteo,
    hayError: false,
    isLoading: cargandoConteo,
    recargar: vi.fn(),
  })
  mocks.useNivelSeccion.mockReturnValue({ nivel, isLoading: false })
  mocks.useIsSuperadmin.mockReturnValue({ isSuperadmin: false, isLoading: false })
  mocks.useOrganizacionDeTrabajo.mockReturnValue({ organizacionId: 'org-1', isLoading: false })
  return render(
    <MemoryRouter>
      {conSeccion ? (
        <RequiereAccesoSeccion seccion="reportes"><ReportesVentas /></RequiereAccesoSeccion>
      ) : (
        <ReportesVentas />
      )}
    </MemoryRouter>,
  )
}

// Las tiendas accesibles llegan de la base: se espera a que el filtro las muestre.
const esperarTiendas = () => screen.findByRole('button', { name: 'San Javucho' })

describe('ReportesVentas (F-VTA-22, FR-005, SC-002, SC-003)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.propsReporte.current = null
    empresaActivaId = 'e-sj'
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    mocks.maybeSingle.mockResolvedValue({ data: { rol_id: 'operador' }, error: null })
  })

  it('muestra título, subtítulo, pestañas y el tablero embebido de «Más vendidos»', async () => {
    montar()
    await esperarTiendas()
    expect(screen.getByRole('heading', { level: 1, name: 'Reportes de ventas' })).toBeInTheDocument()
    expect(screen.getByText('Más vendidos, avisos de «avisame cuando vuelva» y ranking de clientes por facturación.')).toBeInTheDocument()
    const pestanas = screen.getByRole('tablist', { name: 'Reportes de ventas' })
    expect(within(pestanas).getAllByRole('tab').map((pestana) => pestana.textContent)).toEqual([
      'Más vendidos',
      'Ranking de clientes',
    ])
    expect(screen.getByTestId('tablero')).toHaveTextContent('Tablero rep-mas-vendidos')
  })

  it('el filtro de empresa ofrece las tiendas accesibles y sigue a la empresa activa', async () => {
    montar()
    await esperarTiendas()
    const filtro = screen.getByRole('group', { name: 'Filtrar por tienda' })
    expect(within(filtro).getByRole('button', { name: 'Todas las tiendas' })).toBeInTheDocument()
    expect(within(filtro).getByRole('button', { name: 'San Javucho' })).toBeInTheDocument()
    expect(screen.getByText(/si elegís una empresa en la barra superior/)).toBeInTheDocument()
  })

  it('elegir una tienda en el filtro acota el conteo y el tablero a esa tienda', async () => {
    montar()
    await esperarTiendas()
    await screen.findByTestId('tablero')
    // El conteo del período sale de la empresa activa (la del selector de la barra superior).
    expect(mocks.useConteoVentasReporte).toHaveBeenLastCalledWith(
      expect.objectContaining({ empresaId: 'e-sj' }),
    )

    // Elegir otra tienda en las píldoras acota el conteo y el tablero a esa tienda (RF-VTA-22-1):
    // el tablero se remonta con el filtro nuevo y no queda ninguno de la tienda anterior.
    const filtro = screen.getByRole('group', { name: 'Filtrar por tienda' })
    fireEvent.click(within(filtro).getByRole('button', { name: 'Mundo JC' }))
    await waitFor(() =>
      expect(mocks.useConteoVentasReporte).toHaveBeenLastCalledWith(
        expect.objectContaining({ empresaId: 'e-mjc' }),
      ),
    )
    await waitFor(() => expect(mocks.montajes).toHaveBeenCalledTimes(2))
    const rison = mocks.propsReporte.current?.urlParams?.native_filters ?? ''
    expect(rison).toContain("'Mundo JC'")
    expect(rison).not.toContain("'San Javucho'")
  })

  it('preselecciona en el tablero los filtros nativos de período y de empresa', async () => {
    montar()
    await esperarTiendas()
    const rison = mocks.propsReporte.current?.urlParams?.native_filters ?? ''
    expect(rison).toContain('NATIVE_FILTER-rango')
    expect(rison).toContain('time_range:')
    expect(rison).toContain('NATIVE_FILTER-empresa')
    expect(rison).toContain('col:empresa_nombre,op:IN')
    expect(rison).toContain("'San Javucho'")
  })

  it('sin la sección `reportes` ve acceso restringido y no monta el tablero', async () => {
    montar({ nivel: 'ninguno' })
    expect(await screen.findByRole('alert')).toHaveTextContent('Sección no disponible para tu rol')
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1, name: 'Reportes de ventas' })).not.toBeInTheDocument()
  })

  it('un rango sin ventas muestra el estado vacío compartido y no monta el tablero', async () => {
    montar({ conteo: 0 })
    await esperarTiendas()
    expect(screen.getByText('No hay ventas en ese período')).toBeInTheDocument()
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()
  })

  it('mientras cargan el conteo o los reportes muestra el estado de carga compartido', () => {
    montar({ cargandoConteo: true })
    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()
  })

  it('no monta el tablero hasta que llega el conteo del período (un solo pedido de token)', async () => {
    montar({ conteo: null, cargandoConteo: false })
    await esperarTiendas()
    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()
    expect(mocks.montajes).not.toHaveBeenCalled()
  })

  it('ante una falla del tablero muestra el error con Reintentar, que vuelve a montarlo', async () => {
    montar()
    await esperarTiendas()
    expect(mocks.montajes).toHaveBeenCalledTimes(1)
    act(() => mocks.propsReporte.current?.alFallar?.('no_disponible'))
    expect(await screen.findByText('No pudimos cargar el tablero de «Más vendidos».')).toBeInTheDocument()
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByTestId('tablero')).toBeInTheDocument()
    expect(mocks.montajes).toHaveBeenCalledTimes(2)
  })

  it('ante un 403 del token muestra el acceso restringido en lugar del tablero', async () => {
    montar()
    await esperarTiendas()
    act(() => mocks.propsReporte.current?.alFallar?.('prohibido'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Sección no disponible para tu rol')
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()
  })

  it('tras una falla del tablero, cambiar el período vuelve a montar el tablero con los filtros nuevos', async () => {
    montar()
    await esperarTiendas()
    expect(mocks.montajes).toHaveBeenCalledTimes(1)
    act(() => mocks.propsReporte.current?.alFallar?.('no_disponible'))
    expect(await screen.findByText('No pudimos cargar el tablero de «Más vendidos».')).toBeInTheDocument()
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()

    // El error era del período anterior: con otro período el tablero se vuelve a montar (no hace
    // falta apretar «Reintentar»).
    fireEvent.click(screen.getByRole('button', { name: '7 días' }))
    expect(await screen.findByTestId('tablero')).toBeInTheDocument()
    expect(mocks.montajes).toHaveBeenCalledTimes(2)
  })

  it('si el tablero no está asignado a la organización lo dice sin detalle técnico', async () => {
    montar({ reportes: [{ id: 'otro', nombre: 'Ventas mensuales' }] })
    await esperarTiendas()
    expect(screen.getByText('El tablero de «Más vendidos» todavía no está disponible para tu organización.')).toBeInTheDocument()
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()
  })

  it('cambiar la empresa activa reencuadra el tablero y no deja filas de la empresa anterior (Principio VIII)', async () => {
    montar()
    await esperarTiendas()
    await screen.findByTestId('tablero')
    await waitFor(() => expect(mocks.montajes).toHaveBeenCalledTimes(1))
    expect(mocks.propsReporte.current?.urlParams?.native_filters).toContain("'San Javucho'")

    await act(async () => {
      empresaActivaId = 'e-mjc'
      notificarEmpresaActivaCambiada()
    })

    await waitFor(() => expect(mocks.montajes).toHaveBeenCalledTimes(2))
    const rison = mocks.propsReporte.current?.urlParams?.native_filters ?? ''
    expect(rison).toContain("'Mundo JC'")
    expect(rison).not.toContain("'San Javucho'")
  })

  it('los atajos de período cambian el rango y se aplican con el teclado', async () => {
    montar()
    await esperarTiendas()
    const atajos = screen.getByRole('group', { name: 'Atajos de período' })
    const sieteDias = within(atajos).getByRole('button', { name: '7 días' })
    sieteDias.focus()
    expect(sieteDias).toHaveFocus()
    fireEvent.click(sieteDias)
    expect(screen.getByLabelText('Desde')).not.toHaveValue('')
    expect(screen.getByLabelText('Hasta')).not.toHaveValue('')
    expect(mocks.montajes).toHaveBeenCalledTimes(2)
  })

  it('los campos Desde y Hasta tienen nombre accesible y el vacío se anuncia', async () => {
    montar({ conteo: 0 })
    await esperarTiendas()
    expect(screen.getByLabelText('Desde')).toBeInTheDocument()
    expect(screen.getByLabelText('Hasta')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('No hay ventas en ese período')
  })

  describe('Exportar a Excel (F-VTA-23, FR-009, SC-004, SC-005)', () => {
    it('el botón vive en el encabezado de la pestaña del ranking, no en «Más vendidos»', async () => {
      montar()
      await esperarTiendas()
      expect(screen.queryByRole('button', { name: 'Exportar a Excel' })).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('tab', { name: 'Ranking de clientes' }))
      expect(await screen.findByRole('button', { name: 'Exportar a Excel' })).toBeInTheDocument()
    })

    it('exporta el ranking con los filtros vigentes: período, tienda y «Consumidor final»', async () => {
      mocks.exportar.mockResolvedValue(new Blob(['x']))
      montar()
      await esperarTiendas()
      fireEvent.click(screen.getByRole('tab', { name: 'Ranking de clientes' }))
      const boton = await screen.findByRole('button', { name: 'Exportar a Excel' })

      // El interruptor del «Consumidor final» es el de la pantalla: el exporta con el mismo valor.
      fireEvent.click(screen.getByRole('checkbox', { name: 'Consumidor final' }))
      fireEvent.click(boton)

      await waitFor(() => expect(mocks.exportar).toHaveBeenCalled())
      const desde = (screen.getByLabelText('Desde') as HTMLInputElement).value
      const hasta = (screen.getByLabelText('Hasta') as HTMLInputElement).value
      expect(mocks.exportar.mock.calls[0][0]).toEqual({
        desde,
        hasta,
        incluirConsumidorFinal: true,
        empresaId: 'e-sj',
      })
    })

    it('sin la sección `reportes` no muestra el botón de exportar', async () => {
      montar({ conSeccion: false, nivel: 'ninguno' })
      await esperarTiendas()
      fireEvent.click(screen.getByRole('tab', { name: 'Ranking de clientes' }))
      expect(screen.getByRole('tab', { name: 'Ranking de clientes' })).toHaveAttribute('aria-selected', 'true')
      expect(screen.queryByRole('button', { name: 'Exportar a Excel' })).not.toBeInTheDocument()
    })
  })
})
