import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { violacionesAxe } from '../../../test/axe'
import EtiquetaDisponibilidad from './EtiquetaDisponibilidad'

// F-TDA-18 (FR-022, FR-023): texto «Disponible» / «Sin stock», accesible y sin cantidades.
describe('EtiquetaDisponibilidad', () => {
  it('con stock dice «Disponible»', () => {
    render(<EtiquetaDisponibilidad disponible />)
    expect(screen.getByText('Disponible')).toBeInTheDocument()
    expect(screen.queryByText('Sin stock')).not.toBeInTheDocument()
  })

  it('sin stock dice «Sin stock»', () => {
    render(<EtiquetaDisponibilidad disponible={false} />)
    expect(screen.getByText('Sin stock')).toBeInTheDocument()
    expect(screen.queryByText('Disponible')).not.toBeInTheDocument()
  })

  it('el estado se comunica con texto, sin dígitos', () => {
    const { rerender } = render(<EtiquetaDisponibilidad disponible />)
    expect(screen.getByTestId('etiqueta-disponibilidad').textContent).not.toMatch(/\d/)
    rerender(<EtiquetaDisponibilidad disponible={false} />)
    expect(screen.getByTestId('etiqueta-disponibilidad').textContent).not.toMatch(/\d/)
  })

  it('no tiene violaciones de accesibilidad en ningún estado', async () => {
    const { container, rerender } = render(<EtiquetaDisponibilidad disponible />)
    expect(await violacionesAxe(container)).toEqual([])
    rerender(<EtiquetaDisponibilidad disponible={false} />)
    expect(await violacionesAxe(container)).toEqual([])
  })
})
