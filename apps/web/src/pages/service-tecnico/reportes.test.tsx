import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useReportesAsignados: vi.fn(),
  useNivelSeccion: vi.fn(),
  montajes: vi.fn(),
  propsReporte: { current: null as null | { reporteId: string; alFallar?: (motivo: 'prohibido' | 'no_disponible') => void } },
}))
vi.mock('../../hooks/useReportesAsignados', () => ({ useReportesAsignados: mocks.useReportesAsignados }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => <span>Organización: Uno</span> }))
vi.mock('../acceso-restringido/AccesoRestringido', () => ({
  AccesoRestringido: ({ seccion }: { seccion: string }) => <div>Acceso restringido a {seccion}</div>,
}))
// El tablero real monta un iframe de Superset y pide token: acá se simula montaje y fallo.
vi.mock('../../components/ReporteEmbebido', async () => {
  const { useEffect } = await import('react')
  return {
    ReporteEmbebido: (props: { reporteId: string; alFallar?: (motivo: 'prohibido' | 'no_disponible') => void }) => {
      mocks.propsReporte.current = props
      useEffect(() => { mocks.montajes(props.reporteId) }, [props.reporteId])
      return <div data-testid="tablero">Tablero {props.reporteId}</div>
    },
  }
})

import { notificarEmpresaActivaCambiada } from '../../lib/empresaActivaRevision'
import { ServicioReportes } from './reportes'

const REPORTE = { id: 'rep-service', nombre: 'Service técnico' }

const montar = ({ nivel = 'lectura', reportes = [REPORTE] as unknown[], cargandoReportes = false } = {}) => {
  mocks.useReportesAsignados.mockReturnValue({ reportes, isLoading: cargandoReportes })
  mocks.useNivelSeccion.mockReturnValue({ nivel, isLoading: false })
  return render(<MemoryRouter><ServicioReportes /></MemoryRouter>)
}

describe('Service técnico · Reportes (F-SVC-23, FR-064/FR-065)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('con lectura embebe el tablero «Service técnico» y marca la pestaña Reportes', () => {
    montar()
    expect(screen.getByTestId('tablero')).toHaveTextContent('rep-service')
    expect(mocks.montajes).toHaveBeenCalledWith('rep-service')
    expect(screen.getByRole('tab', { name: 'Reportes' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Organización: Uno')).toBeInTheDocument()
  })

  it('con edición también ve el tablero', () => {
    montar({ nivel: 'edicion' })
    expect(screen.getByTestId('tablero')).toBeInTheDocument()
  })

  it('sin lectura en service_tecnico muestra «Acceso restringido» y no monta el tablero (no pide token)', () => {
    montar({ nivel: 'ninguno' })
    expect(screen.getByText('Acceso restringido a Servicio técnico')).toBeInTheDocument()
    expect(mocks.montajes).not.toHaveBeenCalled()
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()
  })

  it('un 403 del token cambia a «Acceso restringido» y no reintenta', () => {
    montar()
    act(() => mocks.propsReporte.current!.alFallar!('prohibido'))
    expect(screen.getByText('Acceso restringido a Servicio técnico')).toBeInTheDocument()
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()
    expect(mocks.montajes).toHaveBeenCalledTimes(1)
  })

  it('muestra carga mientras se resuelven los reportes', () => {
    montar({ cargandoReportes: true })
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()
    expect(mocks.montajes).not.toHaveBeenCalled()
  })

  it('si Superset falla muestra el error con «Reintentar», que remonta el tablero', () => {
    montar()
    act(() => mocks.propsReporte.current!.alFallar!('no_disponible'))
    expect(screen.getByText('No pudimos cargar el tablero de Service técnico.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(screen.getByTestId('tablero')).toBeInTheDocument()
    expect(mocks.montajes).toHaveBeenCalledTimes(2)
  })

  it('si el reporte no está asignado a la organización lo dice, sin tablero', () => {
    montar({ reportes: [] })
    expect(screen.getByText('El tablero de Service técnico todavía no está disponible para tu organización.')).toBeInTheDocument()
    expect(mocks.montajes).not.toHaveBeenCalled()
  })

  it('cambiar de empresa en la barra superior no recarga ni filtra el tablero (compara todas las tiendas)', () => {
    montar()
    expect(mocks.montajes).toHaveBeenCalledTimes(1)
    act(() => notificarEmpresaActivaCambiada())
    expect(screen.getByTestId('tablero')).toBeInTheDocument()
    expect(mocks.montajes).toHaveBeenCalledTimes(1)
  })
})
