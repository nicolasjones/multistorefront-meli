import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { NoEncontrada } from './NoEncontrada'

describe('NoEncontrada (MSF-636)', () => {
  it('muestra la pantalla en castellano con la salida al inicio', () => {
    render(<MemoryRouter><NoEncontrada /></MemoryRouter>)

    expect(screen.getByRole('heading', { level: 1, name: 'No encontramos esta página' })).toBeInTheDocument()
    expect(screen.getByText('La página que buscás no existe')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/')
    expect(screen.queryByText(/Back Home|Sorry/)).not.toBeInTheDocument()
  })
})
