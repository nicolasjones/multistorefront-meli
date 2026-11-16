import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ niveles: {} as Record<string, string> }))
vi.mock('../../../hooks/useNivelSeccion', () => ({ useNivelSeccion: (s: string) => ({ nivel: mocks.niveles[s] ?? 'ninguno', isLoading: false }) }))

import { AccesosDirectos } from '../AccesosDirectos'

const montar = () => render(<MemoryRouter><AccesosDirectos /></MemoryRouter>)

describe('Accesos directos (FR-002)', () => {
  beforeEach(() => { mocks.niveles = {} })

  it('con edición en las tres secciones ofrece los tres accesos', () => {
    mocks.niveles = { ventas: 'edicion', stock: 'edicion', productos: 'edicion' }
    montar()
    expect(screen.getByRole('link', { name: 'Nuevo comprobante' })).toHaveAttribute('href', '/ventas/comprobantes/nuevo')
    expect(screen.getByRole('link', { name: 'Registrar movimiento' })).toHaveAttribute('href', '/stock')
    expect(screen.getByRole('link', { name: 'Nuevo producto' })).toHaveAttribute('href', '/productos/create')
  })

  it('con solo lectura el acceso no existe, y cada uno depende de SU sección', () => {
    mocks.niveles = { ventas: 'lectura', stock: 'edicion', productos: 'ninguno' }
    montar()
    expect(screen.queryByRole('link', { name: 'Nuevo comprobante' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Registrar movimiento' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Nuevo producto' })).not.toBeInTheDocument()
  })
})
