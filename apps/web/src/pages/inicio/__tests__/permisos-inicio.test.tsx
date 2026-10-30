import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ niveles: {} as Record<string, string> }))
vi.mock('../../../hooks/useNivelSeccion', () => ({ useNivelSeccion: (s: string) => ({ nivel: mocks.niveles[s] ?? 'ninguno', isLoading: false }) }))
vi.mock('../../../context/PermisosPanel', () => ({ usePermisosPanel: () => ({ permisos: [], isLoading: false, recargar: () => {} }) }))
vi.mock('../useNombrePerfil', () => ({ useNombrePerfil: () => 'Ada' }))
vi.mock('../TarjetaEmpresas', () => ({ TarjetaEmpresas: () => <div>tarjeta empresas</div> }))
vi.mock('../TarjetaStock', () => ({ TarjetaStock: () => <div>tarjeta stock</div> }))
vi.mock('../TarjetaConsultas', () => ({ TarjetaConsultas: () => <div>tarjeta consultas</div> }))
vi.mock('../TarjetaDolar', () => ({ TarjetaDolar: ({ puedeEditar }: { puedeEditar: boolean }) => <div>tarjeta dolar {puedeEditar ? 'edita' : 'lee'}</div> }))
vi.mock('../AlertasInicio', () => ({ AlertasInicio: () => <div>alertas</div> }))

import { InicioPage } from '..'

const montar = () => render(<MemoryRouter><InicioPage /></MemoryRouter>)

describe('Regla única de permisos de Inicio (FR-007)', () => {
  beforeEach(() => { mocks.niveles = {} })

  it('rol con stock, consultas y dólar ve las tres tarjetas y los accesos de su edición', () => {
    mocks.niveles = { stock: 'edicion', consultas: 'lectura', cotizacion_dolar: 'lectura', ventas: 'edicion' }
    montar()
    expect(screen.getByText('tarjeta stock')).toBeInTheDocument()
    expect(screen.getByText('tarjeta consultas')).toBeInTheDocument()
    expect(screen.getByText('tarjeta dolar lee')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Nuevo comprobante' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Registrar movimiento' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Nuevo producto' })).not.toBeInTheDocument()
  })

  it('rol sin permiso sobre una sección no ve su tarjeta', () => {
    mocks.niveles = { stock: 'lectura' }
    montar()
    expect(screen.getByText('tarjeta stock')).toBeInTheDocument()
    expect(screen.queryByText('tarjeta consultas')).not.toBeInTheDocument()
    expect(screen.queryByText(/tarjeta dolar/)).not.toBeInTheDocument()
  })

  it('con edición en cotización la tarjeta del dólar habilita la acción', () => {
    mocks.niveles = { cotizacion_dolar: 'edicion' }
    montar()
    expect(screen.getByText('tarjeta dolar edita')).toBeInTheDocument()
  })
})
