import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { PaginaNoEncontrada } from './PaginaNoEncontrada'

describe('PaginaNoEncontrada (MSF-636)', () => {
  it('muestra la pantalla propia en castellano, no la de la librería', () => {
    render(<MemoryRouter><PaginaNoEncontrada /></MemoryRouter>)

    expect(screen.getByRole('heading', { level: 1, name: 'No encontramos esta página' })).toBeInTheDocument()
    expect(screen.getByText('Esta página no existe')).toBeInTheDocument()
    expect(screen.queryByText(/Sorry, the page you visited does not exist/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Back Home')).not.toBeInTheDocument()
  })

  it('«Volver al inicio» es un enlace hacia la raíz', () => {
    render(<MemoryRouter><PaginaNoEncontrada /></MemoryRouter>)

    expect(screen.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/')
  })
})
