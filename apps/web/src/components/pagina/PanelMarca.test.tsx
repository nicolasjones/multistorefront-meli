import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PanelMarca } from './PanelMarca'

describe('PanelMarca', () => {
  it('muestra un texto neutro de producto, sin nombres de tiendas ni textos de plantilla', () => {
    const { container } = render(<PanelMarca />)
    expect(screen.getByRole('heading', { level: 2, name: 'Ingresá a tu panel' })).toBeInTheDocument()
    const texto = container.textContent ?? ''
    expect(texto).not.toMatch(/futuras stores|San Javucho|Mundo JC|Panel interno|Varias tiendas|Template/)
  })
})
