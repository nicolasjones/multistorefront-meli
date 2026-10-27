import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  leerConteoVentas: vi.fn(),
  montajes: vi.fn(),
  // Resolvers de cada conteo pedido: el test los usa para decidir cuándo llega la respuesta.
  resolvers: [] as Array<(conteo: number) => void>,
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
  useReportesAsignados: () => ({
    reportes: [{ id: 'rep-mas-vendidos', nombre: 'Ventas · Más vendidos' }],
    isLoading: false,
  }),
}))
// El tablero real monta un iframe de Superset y pide el token del guest: acá se cuenta cada montaje
// (un montaje = un pedido de token).
vi.mock('../../components/ReporteEmbebido', async () => {
  const { useEffect } = await import('react')
  return {
    ReporteEmbebido: (props: { reporteId: string }) => {
      useEffect(() => {
        mocks.montajes(props.reporteId)
      }, [props.reporteId])
      return <div data-testid="tablero">Tablero {props.reporteId}</div>
    },
  }
})

import { MasVendidos } from './MasVendidos'

const OCTUBRE = { desde: '2026-10-01', hasta: '2026-10-31' }
const SEPTIEMBRE = { desde: '2026-09-01', hasta: '2026-09-30' }

const tablero = (rango: { desde: string; hasta: string }) => (
  <MasVendidos rango={rango} empresaId="e-sj" empresaNombre="San Javucho" cargandoEmpresa={false} />
)

// Devuelve el conteo de la respuesta que falta.
const responder = async (indice: number, conteo: number) => {
  await act(async () => {
    mocks.resolvers[indice]?.(conteo)
  })
}

describe('MasVendidos (F-VTA-22, FR-005): el conteo del período y el montaje del tablero', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvers = []
    mocks.leerConteoVentas.mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          mocks.resolvers.push(resolve)
        }),
    )
  })

  it('no monta el tablero hasta que llega el conteo del período', async () => {
    render(tablero(OCTUBRE))
    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()
    expect(mocks.montajes).not.toHaveBeenCalled()

    await responder(0, 5)
    expect(await screen.findByTestId('tablero')).toBeInTheDocument()
    expect(mocks.montajes).toHaveBeenCalledTimes(1)
  })

  it('cambiar el período monta el tablero una sola vez (un pedido de token por cambio de filtro)', async () => {
    const { rerender } = render(tablero(OCTUBRE))
    await responder(0, 5)
    expect(await screen.findByTestId('tablero')).toBeInTheDocument()
    expect(mocks.montajes).toHaveBeenCalledTimes(1)

    // Cambio de período: el conteo de octubre queda viejo y el tablero no se monta con él (si se
    // montara, pediría el token del guest y se volvería a montar al llegar el conteo de septiembre:
    // dos pedidos de token por cada cambio de filtro).
    rerender(tablero(SEPTIEMBRE))
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()
    expect(mocks.montajes).toHaveBeenCalledTimes(1)

    await responder(1, 3)
    expect(await screen.findByTestId('tablero')).toBeInTheDocument()
    await act(async () => {})
    expect(mocks.montajes).toHaveBeenCalledTimes(2)
  })

  it('cambiar la tienda vuelve a contar y monta el tablero una sola vez (Principio VIII)', async () => {
    const { rerender } = render(tablero(OCTUBRE))
    await responder(0, 5)
    expect(await screen.findByTestId('tablero')).toBeInTheDocument()

    rerender(
      <MasVendidos rango={OCTUBRE} empresaId="e-mjc" empresaNombre="Mundo JC" cargandoEmpresa={false} />,
    )
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()

    await responder(1, 2)
    expect(await screen.findByTestId('tablero')).toBeInTheDocument()
    await act(async () => {})
    expect(mocks.montajes).toHaveBeenCalledTimes(2)
  })

  it('un período sin ventas muestra el estado vacío y no monta el tablero', async () => {
    render(tablero(OCTUBRE))
    await responder(0, 0)
    expect(await screen.findByText('No hay ventas en ese período')).toBeInTheDocument()
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()
    expect(mocks.montajes).not.toHaveBeenCalled()
  })
})
