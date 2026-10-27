import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  leerConteoVentas: vi.fn(),
  useReportesAsignados: vi.fn(),
  montajes: vi.fn(),
  // Resolvers de cada conteo pedido: el test los usa para decidir cuándo llega la respuesta.
  resolvers: [] as Array<(conteo: number) => void>,
  // Callback de fallo del tablero embebido (el que avisa que no se pudo cargar).
  alFallar: null as null | ((motivo: 'prohibido' | 'no_disponible') => void),
  propsReporte: {
    current: null as null | {
      reporteId: string
      urlParams?: Record<string, string>
      alFallar?: (motivo: 'prohibido' | 'no_disponible') => void
    },
  },
}))

// El conteo viene de la base: se simula la respuesta, no el hook.
vi.mock('../../lib/ventas-reportes', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/ventas-reportes')>()
  return { ...original, leerConteoVentas: mocks.leerConteoVentas }
})
vi.mock('../../lib/supabase', () => ({ supabaseClient: {} }))
vi.mock('../../hooks/useOrganizacionDeTrabajo', () => ({
  useOrganizacionDeTrabajo: () => ({ organizacionId: 'org-1', isLoading: false }),
}))
vi.mock('../../hooks/useReportesAsignados', () => ({
  useReportesAsignados: () => mocks.useReportesAsignados(),
}))
// El tablero real monta un iframe de Superset y pide el token del guest: acá se cuenta cada montaje
// (un montaje = un pedido de token).
vi.mock('../../components/ReporteEmbebido', async () => {
  const { useEffect } = await import('react')
  return {
    ReporteEmbebido: (props: {
      reporteId: string
      urlParams?: Record<string, string>
      alFallar?: (motivo: 'prohibido' | 'no_disponible') => void
    }) => {
      mocks.propsReporte.current = props
      mocks.alFallar = props.alFallar ?? null
      useEffect(() => {
        mocks.montajes(props.reporteId)
      }, [props.reporteId])
      return <div data-testid="tablero">Tablero {props.reporteId}</div>
    },
  }
})

import { RankingClientes } from './RankingClientes'

const OCTUBRE = { desde: '2026-10-01', hasta: '2026-10-31' }

const tablero = (props: Partial<ComponentProps<typeof RankingClientes>> = {}) => (
  <MemoryRouter>
    <RankingClientes
      rango={OCTUBRE}
      empresaId="e-sj"
      empresaNombre="San Javucho"
      cargandoEmpresa={false}
      {...props}
    />
  </MemoryRouter>
)

// Devuelve el conteo de la respuesta que falta.
const responder = async (indice: number, conteo: number) => {
  await act(async () => {
    mocks.resolvers[indice]?.(conteo)
  })
}

const rison = () => mocks.propsReporte.current?.urlParams?.native_filters ?? ''

describe('RankingClientes (F-VTA-23, FR-008): el tablero del ranking y el interruptor «Consumidor final»', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvers = []
    mocks.alFallar = null
    mocks.propsReporte.current = null
    mocks.useReportesAsignados.mockReturnValue({
      reportes: [{ id: 'rep-ranking', nombre: 'Ventas · Ranking de clientes' }],
      isLoading: false,
    })
    mocks.leerConteoVentas.mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          mocks.resolvers.push(resolve)
        }),
    )
  })

  it('no monta el tablero hasta que llega el conteo del período', async () => {
    render(tablero())
    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()

    await responder(0, 5)
    expect(await screen.findByTestId('tablero')).toBeInTheDocument()
    expect(mocks.montajes).toHaveBeenCalledTimes(1)
  })

  it('el «Consumidor final» arranca excluido y el tablero lo recibe en su filtro nativo', async () => {
    render(tablero())
    await responder(0, 5)
    await screen.findByTestId('tablero')

    const interruptor = screen.getByRole('checkbox', { name: 'Consumidor final' })
    expect(interruptor).not.toBeChecked()

    expect(rison()).toContain('NATIVE_FILTER-consumidor-final')
    expect(rison()).toContain('col:consumidor_final_texto,op:IN')
    expect(rison()).toContain("'No'")
    expect(rison()).not.toContain("'Sí'")
  })

  it('encender el interruptor remonta el tablero con el «Consumidor final» incluido', async () => {
    render(tablero())
    await responder(0, 5)
    await screen.findByTestId('tablero')
    expect(mocks.montajes).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Consumidor final' }))

    expect(await screen.findByTestId('tablero')).toBeInTheDocument()
    await waitFor(() => expect(mocks.montajes).toHaveBeenCalledTimes(2))
    expect(rison()).toContain("'No','Sí'")
  })

  it('preselecciona en el tablero los filtros nativos de período y de empresa', async () => {
    render(tablero())
    await responder(0, 5)
    await screen.findByTestId('tablero')

    expect(rison()).toContain('NATIVE_FILTER-rango')
    expect(rison()).toContain('time_range:')
    expect(rison()).toContain('NATIVE_FILTER-empresa')
    expect(rison()).toContain('col:empresa_nombre,op:IN')
    expect(rison()).toContain("'San Javucho'")
  })

  it('cambiar la tienda reencuadra el tablero y no deja filas de la tienda anterior (Principio VIII)', async () => {
    const { rerender } = render(tablero())
    await responder(0, 5)
    await screen.findByTestId('tablero')
    expect(rison()).toContain("'San Javucho'")

    // Con otra tienda el conteo vuelve a consultarse: hasta que llega, el tablero no se muestra
    // (así no quedan filas de la tienda anterior).
    rerender(tablero({ empresaId: 'e-mjc', empresaNombre: 'Mundo JC' }))
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()

    await responder(1, 2)
    expect(await screen.findByTestId('tablero')).toBeInTheDocument()
    await waitFor(() => expect(mocks.montajes).toHaveBeenCalledTimes(2))
    expect(rison()).toContain("'Mundo JC'")
    expect(rison()).not.toContain("'San Javucho'")
  })

  it('un período sin ventas muestra el estado vacío y no monta el tablero', async () => {
    render(tablero())
    await responder(0, 0)
    expect(await screen.findByText('No hay ventas en ese período')).toBeInTheDocument()
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()
    expect(mocks.montajes).not.toHaveBeenCalled()
  })

  it('si el tablero no está asignado a la organización lo dice sin detalle técnico', async () => {
    mocks.useReportesAsignados.mockReturnValue({
      reportes: [{ id: 'otro', nombre: 'Otro tablero' }],
      isLoading: false,
    })
    render(tablero())
    await responder(0, 5)
    expect(
      await screen.findByText('El tablero de «Ranking de clientes» todavía no está disponible para tu organización.'),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()
  })

  it('ante una falla del tablero muestra el error con Reintentar, que vuelve a montarlo', async () => {
    render(tablero())
    await responder(0, 5)
    await screen.findByTestId('tablero')

    await act(async () => {
      mocks.alFallar?.('no_disponible')
    })
    expect(await screen.findByText('No pudimos cargar el tablero de «Ranking de clientes».')).toBeInTheDocument()
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByTestId('tablero')).toBeInTheDocument()
    expect(mocks.montajes).toHaveBeenCalledTimes(2)
  })

  it('ante un 403 del token muestra el acceso restringido en lugar del tablero', async () => {
    render(tablero())
    await responder(0, 5)
    await screen.findByTestId('tablero')

    await act(async () => {
      mocks.alFallar?.('prohibido')
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('Sección no disponible para tu rol')
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()
  })
})
