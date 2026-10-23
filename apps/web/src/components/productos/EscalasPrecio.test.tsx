import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ useEscalasPrecio: vi.fn() }))
vi.mock('../../hooks/useEscalasPrecio', () => ({ useEscalasPrecio: mocks.useEscalasPrecio }))

import { EscalasPrecio } from './EscalasPrecio'

describe('EscalasPrecio (F-CAT-16, FR-004)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('con escalas de Precios muestra x1, x5, x10 y x50 con su rango, en solo lectura', () => {
    mocks.useEscalasPrecio.mockReturnValue({
      cargando: false,
      escalas: [
        { clave: 'x1', rango: '1 a 4 u.', precio: 100 },
        { clave: 'x5', rango: '5 a 9 u.', precio: '90' },
        { clave: 'x10', rango: '10 a 49 u.', precio: 80 },
        { clave: 'x50', rango: '50 u. o más', precio: 70.5 },
      ],
    })
    render(<EscalasPrecio productoId="p-1" />)
    expect(screen.getByRole('heading', { name: 'Precios por escala · sin IVA' })).toBeInTheDocument()
    for (const rotulo of ['x1 · 1 a 4 u.', 'x5 · 5 a 9 u.', 'x10 · 10 a 49 u.', 'x50 · 50 u. o más']) {
      expect(screen.getByText(rotulo)).toBeInTheDocument()
    }
    expect(screen.getByText('70,50')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByText('No disponible')).not.toBeInTheDocument()
  })

  it.each([null, []])('sin escalas (%j) muestra «No disponible»', (escalas) => {
    mocks.useEscalasPrecio.mockReturnValue({ cargando: false, escalas })
    render(<EscalasPrecio productoId="p-1" />)
    expect(screen.getByText('No disponible')).toBeInTheDocument()
  })

  it('mientras carga avisa y no muestra «No disponible»', () => {
    mocks.useEscalasPrecio.mockReturnValue({ cargando: true, escalas: null })
    render(<EscalasPrecio productoId="p-1" />)
    expect(screen.getByRole('status')).toHaveTextContent('Cargando…')
    expect(screen.queryByText('No disponible')).not.toBeInTheDocument()
  })
})
