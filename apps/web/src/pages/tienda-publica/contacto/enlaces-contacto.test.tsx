import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { MenuCategorias } from '../layout/MenuCategorias'
import { PieCategorias } from '../layout/PieCategorias'

const categorias = { fase: 'lista' as const, categorias: [{ id: 'c-1', nombre: 'Joysticks', padreId: null, productos: 3 }], reintentar: () => undefined }

// F-TDA-16 (FR-010): «Contacto» del menú y «Escribinos» del pie enlazan a /contacto.
describe('enlaces a /contacto', () => {
  it('«Contacto» del menú lleva a /contacto', () => {
    render(<MemoryRouter><MenuCategorias categorias={categorias} /></MemoryRouter>)
    expect(within(screen.getByRole('navigation', { name: 'Categorías' })).getByRole('link', { name: 'Contacto' })).toHaveAttribute('href', '/contacto')
  })

  it('«Escribinos» del pie lleva a /contacto, con o sin categorías', () => {
    const { unmount } = render(<MemoryRouter><PieCategorias categorias={categorias.categorias} /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Escribinos' })).toHaveAttribute('href', '/contacto')
    unmount()
    render(<MemoryRouter><PieCategorias categorias={[]} /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Escribinos' })).toHaveAttribute('href', '/contacto')
    expect(screen.queryByTestId('pie-categorias')).not.toBeInTheDocument()
  })
})
