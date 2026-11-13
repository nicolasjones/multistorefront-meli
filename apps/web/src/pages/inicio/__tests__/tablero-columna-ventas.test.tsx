import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Cableado de `verVentas` entre el tablero y «Movimientos por producto» (hallazgo de la revisión final): sin permiso de
// ventas la columna «Ventas» no aparece aunque la base devolviera cifras; con permiso, sí. El gráfico se simula (x-charts
// se baja diferido y aquí no hace falta).
const mocks = vi.hoisted(() => ({ movimientos: vi.fn() }))

vi.mock('../tablero/GraficoVentasStock', () => ({ GraficoVentasStock: () => null }))
vi.mock('../../../lib/inicioTablero', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/inicioTablero')>()),
  leerResumenInicio: vi.fn().mockResolvedValue({
    desde: '2026-10-01', hasta: '2026-10-15', anterior_desde: '2026-09-16', anterior_hasta: '2026-09-30',
    ventas: null, stock: { unidades: 120, reservado: 20, disponible: 100, sin_stock: 3, stock_bajo: 1, ajustes: 2, entradas_unidades: 15 },
    serie: [{ dia: '2026-10-01', unidades: null, stock: 110 }],
  }),
}))
vi.mock('../../../lib/depositos', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../lib/depositos')>()), listarDepositosActivos: vi.fn().mockResolvedValue([]) }))
vi.mock('../../../lib/inicioBloques', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/inicioBloques')>()),
  leerBloquesInicio: vi.fn().mockResolvedValue({ por_tienda: [], salidas_por_deposito: [] }),
  leerActividadReciente: vi.fn().mockResolvedValue([]),
  leerMovimientosPorProducto: mocks.movimientos,
}))
vi.mock('../../../lib/categorias', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../lib/categorias')>()), leerCategorias: vi.fn().mockResolvedValue({ categorias: [], conteos: new Map() }) }))
vi.mock('../../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: { id: 'org-1' } }) }))
vi.mock('../../../hooks/useFiltroPorEmpresaActiva', () => ({
  useFiltroPorEmpresaActiva: () => ({ empresas: [], valor: null, cambiar: vi.fn(), empresaActivaId: null, cargando: false, hayError: false }),
}))

import { TableroInicio } from '../tablero/TableroInicio'

const FILA = {
  productoId: 'p-1', nombre: 'Producto 1', sku: 'SKU-1', categoria: 'Periféricos', stockInicial: 8, entradas: 5, salidas: 3, ajustes: -2,
  stockActual: 10, minimo: 5, ventas: 4, ultimoMovimiento: '2026-10-12', estado: 'normal',
}
const abrir = (verVentas: boolean) => render(
  <MemoryRouter initialEntries={['/']}><TableroInicio verVentas={verVentas} verStock verActividad={false} verReportes={false} /></MemoryRouter>,
)

beforeEach(() => { mocks.movimientos.mockReset(); mocks.movimientos.mockResolvedValue({ filas: [FILA], total: 1 }) })

describe('TableroInicio → Movimientos por producto: columna «Ventas»', () => {
  it('sin permiso de ventas la columna no aparece aunque la base traiga cifras', async () => {
    abrir(false)
    const tabla = await screen.findByRole('table', { name: 'Movimientos por producto' }, { timeout: 15_000 })
    const encabezados = within(tabla).getAllByRole('columnheader').map((th) => th.textContent)
    expect(encabezados).not.toContain('Ventas')
    expect(encabezados).toContain('Mínimo')
  })

  it('con permiso de ventas la columna aparece', async () => {
    abrir(true)
    const tabla = await screen.findByRole('table', { name: 'Movimientos por producto' }, { timeout: 15_000 })
    await waitFor(() => expect(within(tabla).getAllByRole('columnheader').map((th) => th.textContent)).toContain('Ventas'))
  })
})
