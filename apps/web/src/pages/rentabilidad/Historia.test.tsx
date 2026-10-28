import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useReportesAsignados: vi.fn(),
  montajes: vi.fn(),
  propsReporte: {
    current: null as null | {
      reporteId: string
      urlParams?: Record<string, string>
      alFallar?: (motivo: 'prohibido' | 'no_disponible') => void
    },
  },
}))
vi.mock('../../hooks/useReportesAsignados', () => ({ useReportesAsignados: mocks.useReportesAsignados }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => <span>Organización: Uno</span> }))
vi.mock('../acceso-restringido/AccesoRestringido', () => ({
  AccesoRestringido: ({ seccion }: { seccion: string }) => <div>Acceso restringido a {seccion}</div>,
}))
// El tablero real monta un iframe de Superset y pide token: acá se simula montaje, parámetros y fallo.
vi.mock('../../components/ReporteEmbebido', async () => {
  const { useEffect } = await import('react')
  return {
    ReporteEmbebido: (props: { reporteId: string; urlParams?: Record<string, string>; alFallar?: (motivo: 'prohibido' | 'no_disponible') => void }) => {
      mocks.propsReporte.current = props
      useEffect(() => { mocks.montajes(props.reporteId) }, [props.reporteId])
      return <div data-testid="tablero">Tablero {props.reporteId}</div>
    },
  }
})

import { notificarEmpresaActivaCambiada } from '../../lib/empresaActivaRevision'
import { RentabilidadHistoria } from './Historia'

const REPORTE = { id: 'rep-historia', nombre: 'Rentabilidad · Historia' }

const montar = ({
  reportes = [REPORTE, { id: 'rep-resumen', nombre: 'Rentabilidad · Resumen' }] as unknown[],
  cargando = false,
}: { reportes?: unknown[]; cargando?: boolean } = {}) => {
  mocks.useReportesAsignados.mockReturnValue({ reportes, isLoading: cargando })
  return render(
    <MemoryRouter initialEntries={['/rentabilidad/historia']}>
      <Routes>
        <Route path="/rentabilidad/historia" element={<RentabilidadHistoria />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RentabilidadHistoria', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.propsReporte.current = null
  })

  it('muestra título, pestañas (con Historia y sin Mercado Libre) y embebe el tablero «Historia»', () => {
    montar()
    expect(screen.getByRole('heading', { level: 1, name: 'Rentabilidad' })).toBeInTheDocument()
    const pestanas = screen.getByRole('tablist', { name: 'Secciones de Rentabilidad' })
    expect(within(pestanas).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Resumen', 'Por producto', 'Comparativo', 'Historia'])
    expect(within(pestanas).getByRole('tab', { name: 'Historia' })).toHaveAttribute('href', '/rentabilidad/historia')
    expect(screen.getByTestId('tablero')).toHaveTextContent('Tablero rep-historia')
    expect(screen.queryByText(/Mercado Libre/)).not.toBeInTheDocument()
    expect(screen.queryByText(/por publicación de ML/i)).not.toBeInTheDocument()
  })

  it('mientras carga los reportes muestra el estado de carga compartido', () => {
    montar({ cargando: true })
    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()
  })

  it('si el tablero no está asignado a la organización muestra el estado de error sin detalle técnico', () => {
    montar({ reportes: [{ id: 'rep-resumen', nombre: 'Rentabilidad · Resumen' }] })
    expect(screen.getByText('El tablero de Rentabilidad todavía no está disponible para tu organización.')).toBeInTheDocument()
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()
  })

  it('ante una falla del tablero muestra el error con Reintentar, que repite el montaje', async () => {
    montar()
    expect(mocks.montajes).toHaveBeenCalledTimes(1)
    act(() => mocks.propsReporte.current?.alFallar?.('no_disponible'))
    expect(await screen.findByText('No pudimos cargar el tablero de Rentabilidad.')).toBeInTheDocument()
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByTestId('tablero')).toBeInTheDocument()
    expect(mocks.montajes).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(screen.queryByText('No pudimos cargar el tablero de Rentabilidad.')).not.toBeInTheDocument())
  })

  it('ante un 403 del token muestra el acceso restringido en lugar de la pantalla', () => {
    montar()
    act(() => mocks.propsReporte.current?.alFallar?.('prohibido'))
    expect(screen.getByText('Acceso restringido a Rentabilidad')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Rentabilidad' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()
  })

  it('no pasa filtros ni empresa al tablero y el cambio de empresa de la barra superior no lo altera (SC-006)', () => {
    montar()
    const propsAntes = mocks.propsReporte.current
    expect(propsAntes?.urlParams).toBeUndefined()
    act(() => notificarEmpresaActivaCambiada())
    expect(mocks.montajes).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('tablero')).toHaveTextContent('Tablero rep-historia')
    expect(mocks.propsReporte.current?.reporteId).toBe(propsAntes?.reporteId)
    expect(mocks.propsReporte.current?.urlParams).toBeUndefined()
  })

  it('se puede operar con teclado: las pestañas son enfocables y la nota es un aviso legible', () => {
    montar()
    for (const pestana of screen.getAllByRole('tab')) {
      pestana.focus()
      expect(pestana).toHaveFocus()
    }
    expect(screen.getByRole('status')).toHaveTextContent('Elegí un producto para ver cómo evolucionó su margen en cada empresa')
  })
})
