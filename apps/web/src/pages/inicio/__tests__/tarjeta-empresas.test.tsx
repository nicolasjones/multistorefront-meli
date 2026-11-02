import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ acc: {} as Record<string, unknown>, nivel: 'lectura' as string }))
vi.mock('../../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: () => mocks.acc }))
vi.mock('../../../hooks/useNivelSeccion', () => ({ useNivelSeccion: () => ({ nivel: mocks.nivel, isLoading: false }) }))

import { TarjetaEmpresas } from '../TarjetaEmpresas'

const montar = () => render(<MemoryRouter><TarjetaEmpresas /></MemoryRouter>)

describe('Tarjeta de empresas (FR-003)', () => {
  beforeEach(() => {
    mocks.nivel = 'lectura'
    mocks.acc = { empresas: [{ id: 'e1', nombre: 'Mundo JC', esActiva: true, rolId: null }, { id: 'e2', nombre: 'Tienda Sur', esActiva: false, rolId: null }], isLoading: false, isError: false, refetch: vi.fn() }
  })

  it('lista solo las empresas accesibles y marca la activa', () => {
    montar()
    expect(screen.getByText('Mundo JC')).toBeInTheDocument()
    expect(screen.getByText('Tienda Sur')).toBeInTheDocument()
    expect(screen.getAllByText('Empresa activa')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Ver empresas' })).toHaveAttribute('href', '/empresas')
  })

  it('sin lectura de Empresas no ofrece el enlace', () => {
    mocks.nivel = 'ninguno'
    montar()
    expect(screen.queryByRole('link', { name: 'Ver empresas' })).not.toBeInTheDocument()
  })

  it('sin empresas explica el vacío', () => {
    mocks.acc = { empresas: [], isLoading: false, isError: false, refetch: vi.fn() }
    montar()
    expect(screen.getByText('Todavía no tenés empresas asignadas.')).toBeInTheDocument()
  })
})
