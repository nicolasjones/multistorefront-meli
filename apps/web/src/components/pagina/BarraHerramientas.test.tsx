import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BarraHerramientas } from './BarraHerramientas'

describe('BarraHerramientas', () => {
  it('muestra los controles recibidos y el contador', () => {
    render(
      <BarraHerramientas contador="12 clientes">
        <input aria-label="Buscar" />
      </BarraHerramientas>,
    )

    expect(screen.getByLabelText('Buscar')).toBeInTheDocument()
    expect(screen.getByText('12 clientes')).toBeInTheDocument()
  })

  it('muestra el texto de ayuda cuando se provee', () => {
    render(
      <BarraHerramientas ayuda="Elegí una empresa para filtrar.">
        <input aria-label="Buscar" />
      </BarraHerramientas>,
    )

    expect(screen.getByText('Elegí una empresa para filtrar.')).toBeInTheDocument()
  })

  it('no exige contador ni ayuda', () => {
    render(
      <BarraHerramientas>
        <input aria-label="Buscar" />
      </BarraHerramientas>,
    )

    expect(screen.getByLabelText('Buscar')).toBeInTheDocument()
  })
})
