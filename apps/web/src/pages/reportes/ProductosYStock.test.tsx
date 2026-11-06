import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useReportesAsignados: vi.fn(),
  useNivelSeccion: vi.fn(),
  useIsSuperadmin: vi.fn(),
  useOrganizacionDeTrabajo: vi.fn(),
  montajes: vi.fn(),
  propsReporte: { current: null as null | { reporteId: string; alFallar?: (motivo: 'prohibido' | 'no_disponible') => void } },
}))
vi.mock('../../hooks/useReportesAsignados', () => ({ useReportesAsignados: mocks.useReportesAsignados }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/useIsSuperadmin', () => ({ useIsSuperadmin: mocks.useIsSuperadmin }))
vi.mock('../../hooks/useOrganizacionDeTrabajo', () => ({ useOrganizacionDeTrabajo: mocks.useOrganizacionDeTrabajo }))
vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: () => { throw new Error('no debería consultar nada') },
  },
}))
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

import { RequiereAccesoSeccion } from '../../components/RequiereAccesoSeccion'
import { DESTINOS_PANEL } from '../../components/navegacion/destinosPanel'
import { SECCION_INVENTARIO } from '../../lib/reportes-inventario'
import { ProductosYStock } from './ProductosYStock'

const REPORTE = { id: 'rep-stock', nombre: 'Inventario · Productos y stock' }

// La pantalla tal como la monta App.tsx: envuelta en RequiereAccesoSeccion (`stock`).
const montar = ({
  nivel = 'lectura',
  reportes = [REPORTE] as unknown[],
  cargando = false,
}: { nivel?: string | null; reportes?: unknown[]; cargando?: boolean } = {}) => {
  mocks.useReportesAsignados.mockReturnValue({ reportes, isLoading: cargando })
  mocks.useNivelSeccion.mockReturnValue({ nivel, isLoading: false })
  mocks.useIsSuperadmin.mockReturnValue({ isSuperadmin: false, isLoading: false })
  mocks.useOrganizacionDeTrabajo.mockReturnValue({ organizacionId: 'org-1', isLoading: false })
  return render(
    <MemoryRouter initialEntries={['/reportes/inventario']}>
      <RequiereAccesoSeccion seccion={SECCION_INVENTARIO}><ProductosYStock /></RequiereAccesoSeccion>
    </MemoryRouter>,
  )
}

describe('ProductosYStock (F-REP-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.propsReporte.current = null
  })

  it('[MSF-297:T004] muestra el título y monta el tablero embebido del reporte', () => {
    montar()
    expect(screen.getByRole('heading', { name: 'Productos y stock' })).toBeTruthy()
    expect(screen.getByTestId('tablero').textContent).toBe('Tablero rep-stock')
    expect(mocks.montajes).toHaveBeenCalledWith('rep-stock')
  })

  it('[MSF-297:T004] muestra el estado de carga mientras llegan los reportes', () => {
    montar({ cargando: true })
    expect(screen.queryByTestId('tablero')).toBeNull()
    expect(mocks.montajes).not.toHaveBeenCalled()
  })

  it('[MSF-297:T004] avisa cuando el tablero no está asignado a la organización', () => {
    montar({ reportes: [] })
    expect(screen.getByText(/todavía no está disponible para tu organización/)).toBeTruthy()
    expect(screen.queryByTestId('tablero')).toBeNull()
  })

  it('[MSF-297:T005] sin la sección stock muestra «Acceso restringido» y no monta el tablero ni pide token', async () => {
    montar({ nivel: 'ninguno' })
    expect(await screen.findByText('Acceso restringido a Stock')).toBeTruthy()
    expect(screen.queryByTestId('tablero')).toBeNull()
    expect(mocks.montajes).not.toHaveBeenCalled()
  })

  it('[MSF-297:T005] ante un 403 del token muestra «Acceso restringido»', () => {
    montar()
    act(() => mocks.propsReporte.current?.alFallar?.('prohibido'))
    expect(screen.getByText('Acceso restringido a Stock')).toBeTruthy()
    expect(screen.queryByTestId('tablero')).toBeNull()
  })

  it('[MSF-297:T005] ante una falla de carga muestra el error y «Reintentar» vuelve a montar el tablero', async () => {
    montar()
    expect(mocks.montajes).toHaveBeenCalledTimes(1)
    act(() => mocks.propsReporte.current?.alFallar?.('no_disponible'))
    expect(screen.getByText(/No pudimos cargar el tablero de «Productos y stock»/)).toBeTruthy()
    expect(screen.queryByTestId('tablero')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(screen.getByTestId('tablero')).toBeTruthy())
    expect(mocks.montajes).toHaveBeenCalledTimes(2)
  })

  it('[MSF-297:T005] no tiene selector de empresa propio (el inventario es por organización)', () => {
    montar()
    expect(screen.queryByRole('group', { name: /empresa|tienda/i })).toBeNull()
    expect(screen.queryByText('Todas las tiendas')).toBeNull()
  })
})

describe('menú «Reportes» (F-REP-01, FR-001)', () => {
  it('[MSF-297:T004] «Productos y stock» apunta a /reportes/inventario y exige la sección stock', () => {
    const destino = DESTINOS_PANEL.find((candidato) => candidato.id === 'reportes-inventario')
    expect(destino?.etiqueta).toBe('Productos y stock')
    expect(destino?.ruta).toBe('/reportes/inventario')
    expect(destino?.seccionPermiso).toBe('stock')
  })
})
