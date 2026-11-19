import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useReportesAsignados: vi.fn(),
  useBandera: vi.fn(),
  useFiltro: vi.fn(),
  cambiar: vi.fn(),
  montajes: vi.fn(),
  propsReporte: {
    current: null as null | { reporteId: string; urlParams?: Record<string, string>; alFallar?: (motivo: 'prohibido' | 'no_disponible') => void },
  },
}))
vi.mock('../../hooks/useReportesAsignados', () => ({ useReportesAsignados: mocks.useReportesAsignados }))
vi.mock('../../hooks/useBanderaMargenCostosFijos', () => ({ useBanderaMargenCostosFijos: mocks.useBandera }))
vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: mocks.useFiltro }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => <span>Organización: Uno</span> }))
vi.mock('../acceso-restringido/AccesoRestringido', () => ({
  AccesoRestringido: ({ seccion }: { seccion: string }) => <div>Acceso restringido a {seccion}</div>,
}))
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

import { violacionesAxe } from '../../test/axe'
import { RentabilidadCostosFijos } from './CostosFijos'

const REPORTE = { id: 'rep-fijos', nombre: 'Rentabilidad · Después de costos fijos' }
const EMPRESAS = [{ id: 'e1', nombre: 'San Javucho' }, { id: 'e2', nombre: 'Mundo JC' }]

const montar = ({ activa = true, cargandoBandera = false, reportes = [REPORTE] as unknown[], cargando = false, empresaId = null as string | null } = {}) => {
  mocks.useBandera.mockReturnValue({ activa, cargando: cargandoBandera })
  mocks.useReportesAsignados.mockReturnValue({ reportes, isLoading: cargando })
  mocks.useFiltro.mockReturnValue({ empresas: EMPRESAS, valor: empresaId, cambiar: mocks.cambiar, cargando: false, hayError: false })
  return render(
    <MemoryRouter initialEntries={['/rentabilidad/costos-fijos']}>
      <Routes>
        <Route path="/rentabilidad/costos-fijos" element={<RentabilidadCostosFijos />} />
        <Route path="/rentabilidad" element={<div>Resumen de Rentabilidad</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RentabilidadCostosFijos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.propsReporte.current = null
  })

  it('con la bandera apagada la ruta redirige a Rentabilidad y no monta ni pide el tablero', () => {
    montar({ activa: false })
    expect(screen.getByText('Resumen de Rentabilidad')).toBeInTheDocument()
    expect(mocks.montajes).not.toHaveBeenCalled()
  })

  it('mientras lee la bandera muestra el estado de carga y no redirige', () => {
    montar({ activa: false, cargandoBandera: true })
    expect(screen.queryByText('Resumen de Rentabilidad')).not.toBeInTheDocument()
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()
  })

  it('con la bandera encendida muestra título, la pestaña propia, el método, el mes en curso y embebe el tablero', () => {
    montar()
    expect(screen.getByRole('heading', { level: 1, name: 'Rentabilidad' })).toBeInTheDocument()
    expect(screen.getByTestId('tablero')).toHaveTextContent('Tablero rep-fijos')
    expect(screen.getByRole('note')).toHaveTextContent(/en proporción a sus ventas netas sin IVA/)
    expect(screen.getByRole('note')).toHaveTextContent(/mes en curso es provisorio/)
    expect(mocks.propsReporte.current?.urlParams).toEqual({})
  })

  it('sigue la empresa activa: el tablero se monta con el filtro de la tienda elegida', () => {
    montar({ empresaId: 'e1' })
    expect(mocks.propsReporte.current?.urlParams?.native_filters).toContain('San Javucho')
    expect(mocks.propsReporte.current?.urlParams?.native_filters).toContain('NATIVE_FILTER-empresa')
  })

  it('al cambiar la tienda con el filtro de la pantalla llama a cambiar con la empresa', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Mundo JC' }))
    expect(mocks.cambiar).toHaveBeenCalledWith('e2')
  })

  it('ante un 403 del token muestra el acceso restringido igual que Comparativo e Historia', async () => {
    montar()
    act(() => mocks.propsReporte.current?.alFallar?.('prohibido'))
    expect(await screen.findByText('Acceso restringido a Rentabilidad')).toBeInTheDocument()
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()
  })

  it('ante un fallo de carga muestra el error con «Reintentar» y reintenta remontando el tablero', async () => {
    montar()
    act(() => mocks.propsReporte.current?.alFallar?.('no_disponible'))
    expect(await screen.findByText(/No pudimos cargar el tablero/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Reintentar/i }))
    await waitFor(() => expect(screen.getByTestId('tablero')).toBeInTheDocument())
    expect(mocks.montajes).toHaveBeenCalledTimes(2)
  })

  it('si el tablero no está registrado para la organización lo dice, sin tablero ni reintento', () => {
    montar({ reportes: [] })
    expect(screen.getByText(/falta importarlo en este entorno\. Pedile al administrador de la plataforma/)).toBeInTheDocument()
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()
  })

  it('mientras cargan los reportes muestra el estado de carga compartido', () => {
    montar({ cargando: true })
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()
  })
})

describe.each([320, 768, 1440])('accesibilidad de la pestaña «Después de costos fijos» a %i px', (ancho) => {
  it('no tiene violaciones de axe', async () => {
    window.innerWidth = ancho
    const { container } = montar()
    expect(await violacionesAxe(container)).toEqual([])
  })
})
