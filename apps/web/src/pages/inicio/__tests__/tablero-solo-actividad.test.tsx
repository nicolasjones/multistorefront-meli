import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// MSF-821 (revisión): un rol con solo `actividad` ≥ lectura (sin ventas ni stock) ve «Actividad reciente» y NO
// consulta el resumen de ventas y stock ni el listado de movimientos (el tablero real, sin mockear su montaje).
const mocks = vi.hoisted(() => ({ resumen: vi.fn(), depositos: vi.fn(), bloques: vi.fn(), actividad: vi.fn(), movimientos: vi.fn() }))

vi.mock('../../../lib/inicioTablero', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../lib/inicioTablero')>()), leerResumenInicio: mocks.resumen }))
vi.mock('../../../lib/depositos', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../lib/depositos')>()), listarDepositosActivos: mocks.depositos }))
vi.mock('../../../lib/inicioBloques', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/inicioBloques')>()),
  leerBloquesInicio: mocks.bloques,
  leerActividadReciente: mocks.actividad,
  leerMovimientosPorProducto: mocks.movimientos,
}))
vi.mock('../../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: { id: 'org-1' } }) }))
vi.mock('../../../hooks/useFiltroPorEmpresaActiva', () => ({
  useFiltroPorEmpresaActiva: () => ({ empresas: [{ id: 'e-1', nombre: 'San Javucho' }], valor: null, cambiar: vi.fn(), empresaActivaId: null, cargando: false, hayError: false }),
}))

import { TableroInicio } from '../tablero/TableroInicio'

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset())
  mocks.depositos.mockResolvedValue([])
  mocks.actividad.mockResolvedValue([
    { id: 'ev-1', creadoEn: '2026-10-15T14:30:00Z', tipo: 'producto.creado', empresaId: null, empresaNombre: null, actorId: null, actorNombre: 'Emilse', detalle: 'Alta de Mouse' },
  ])
})

describe('rol con solo actividad', () => {
  it('ve «Actividad reciente» y no consulta ventas, stock ni movimientos', async () => {
    render(<MemoryRouter><TableroInicio verVentas={false} verStock={false} verActividad /></MemoryRouter>)
    expect(await screen.findByRole('list', { name: 'Actividad reciente' })).toBeInTheDocument()
    expect(mocks.resumen).not.toHaveBeenCalled()
    expect(mocks.bloques).not.toHaveBeenCalled()
    expect(mocks.movimientos).not.toHaveBeenCalled()
    expect(screen.queryByText('Ventas del período')).not.toBeInTheDocument()
    expect(screen.queryByText('Movimientos por producto')).not.toBeInTheDocument()
    expect(screen.queryByText(/Tu rol no tiene ventas ni stock/)).not.toBeInTheDocument()
  })
})
