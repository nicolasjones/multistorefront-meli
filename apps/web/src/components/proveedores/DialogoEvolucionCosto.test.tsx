import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ useHistorialCostos: vi.fn(), useNivelSeccion: vi.fn(), recargar: vi.fn() }))

vi.mock('../../hooks/useHistorialCostos', () => ({ useHistorialCostos: mocks.useHistorialCostos }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))

import type { PuntoCosto } from '../../hooks/useHistorialCostos'
import { DialogoEvolucionCosto } from './DialogoEvolucionCosto'

const punto = (n: number, extra: Partial<PuntoCosto> = {}): PuntoCosto => ({
  proveedor_id: 'prv-1', proveedor_razon_social: 'Proveedor Uno', ingreso_id: `ing-${n}`,
  fecha: `2026-10-0${n}`, comprobante: `R-${n}`, costo_unitario_usd: 10 * n, ...extra,
})

const respuesta = (puntos: PuntoCosto[], extra: Record<string, unknown> = {}) => ({
  puntos, cargando: false, hayError: false, recargar: mocks.recargar, ...extra,
})

const abrir = () => render(<DialogoEvolucionCosto open producto={{ id: 'p-1', nombre: 'Joystick' }} onCerrar={vi.fn()} />)

describe('DialogoEvolucionCosto', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    mocks.useHistorialCostos.mockReturnValue(respuesta([punto(1), punto(2)]))
  })

  it('[MSF-448:T018] muestra una serie por proveedor con fecha, comprobante y costo en USD', () => {
    mocks.useHistorialCostos.mockReturnValue(respuesta([
      punto(1), punto(2),
      punto(3, { proveedor_id: 'prv-2', proveedor_razon_social: 'Proveedor Dos', comprobante: null, costo_unitario_usd: 1234.5 }),
    ]))
    abrir()
    expect(screen.getByRole('heading', { name: /Evolución del costo · Joystick/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Proveedor Uno' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Proveedor Dos' })).toBeInTheDocument()
    expect(screen.getAllByText('USD 10,00').length).toBeGreaterThan(0)
    expect(screen.getAllByText('01/10/2026').length).toBeGreaterThan(0)
    expect(screen.getAllByText('USD 1.234,50').length).toBeGreaterThan(0)
    expect(screen.getAllByText('R-2').length).toBeGreaterThan(0)
    expect(within(screen.getByRole('dialog')).getAllByText('—').length).toBeGreaterThan(0)
  })

  it('consulta el producto sin acotar proveedor cuando tiene permisos', () => {
    abrir()
    expect(mocks.useHistorialCostos).toHaveBeenCalledWith('p-1', null, true)
  })

  it('muestra el estado de carga', () => {
    mocks.useHistorialCostos.mockReturnValue(respuesta([], { cargando: true }))
    abrir()
    expect(screen.queryByText('Todavía no hay costos registrados.')).not.toBeInTheDocument()
    expect(screen.queryByText('Proveedor Uno')).not.toBeInTheDocument()
  })

  it('muestra el estado vacío (CA-PRV-07-2: sin costo no hay punto)', () => {
    mocks.useHistorialCostos.mockReturnValue(respuesta([]))
    abrir()
    expect(screen.getByText('Todavía no hay costos registrados.')).toBeInTheDocument()
  })

  it('muestra el error y permite reintentar', () => {
    mocks.useHistorialCostos.mockReturnValue(respuesta([], { hayError: true }))
    abrir()
    expect(screen.getByText('No pudimos cargar la evolución del costo.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(mocks.recargar).toHaveBeenCalled()
  })

  it('sin Rentabilidad o sin Proveedores no consulta ni muestra importes', () => {
    mocks.useNivelSeccion.mockImplementation((seccion: string) => ({ nivel: seccion === 'rentabilidad' ? 'ninguno' : 'edicion', isLoading: false }))
    mocks.useHistorialCostos.mockReturnValue(respuesta([]))
    abrir()
    expect(mocks.useHistorialCostos).toHaveBeenCalledWith('p-1', null, false)
    expect(screen.getByText('No tenés permiso.')).toBeInTheDocument()
    expect(screen.queryByText(/USD/)).not.toBeInTheDocument()
  })
})
