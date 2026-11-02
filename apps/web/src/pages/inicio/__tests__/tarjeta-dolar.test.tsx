import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ estado: vi.fn(), dia: vi.fn() }))
vi.mock('../../../hooks/useCotizacion', () => ({ useEstadoCotizacion: mocks.estado }))
vi.mock('../../../hooks/useCotizacionDelDia', () => ({ useCotizacionDelDia: mocks.dia }))

import { TarjetaDolar } from '../TarjetaDolar'

const VIGENTE = { vigente: { valor: 1465, cargadaEn: '2026-09-25T12:00:00Z', cargadaPor: 'Javier' }, productosUsd: 3, pendiente: null }
const montar = (puedeEditar: boolean, delDia: unknown) => {
  mocks.estado.mockReturnValue({ estado: VIGENTE, cargando: false, hayError: false, recargar: vi.fn() })
  mocks.dia.mockReturnValue({ delDia, cargando: false, hayError: false, recargar: vi.fn() })
  return render(<MemoryRouter><TarjetaDolar puedeEditar={puedeEditar} /></MemoryRouter>)
}

describe('Tarjeta de dólar (FR-006)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('cargado hoy: muestra la cotización vigente y no avisa', () => {
    montar(true, { cargadaHoy: true, cargadaEn: '2026-10-23T13:00:00Z', cargadaPor: 'Admin', valor: 1490 })
    expect(screen.getByText(/1\.465/)).toBeInTheDocument()
    expect(screen.getByText(/Última carga/)).toBeInTheDocument()
    expect(screen.queryByText('Todavía no se cargó el dólar de hoy')).not.toBeInTheDocument()
  })

  it('sin cargar hoy con edición: avisa y ofrece «Cargar ahora» hacia Cotización', () => {
    montar(true, { cargadaHoy: false, cargadaEn: null, cargadaPor: null, valor: null })
    expect(screen.getByText('Todavía no se cargó el dólar de hoy')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cargar ahora' })).toHaveAttribute('href', '/cotizacion')
  })

  it('sin cargar hoy con solo lectura: avisa pero no ofrece cargar', () => {
    montar(false, { cargadaHoy: false, cargadaEn: null, cargadaPor: null, valor: null })
    expect(screen.getByText('Todavía no se cargó el dólar de hoy')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Cargar ahora' })).not.toBeInTheDocument()
  })
})
