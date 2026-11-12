import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { PieCategorias } from '../layout/PieCategorias'

// El pie suma el bloque legal (F-TDA-22): acá no se prueba, así que no sale a la red.
vi.mock('../../../lib/tiendaLegal', async (original) => ({ ...(await original<typeof import('../../../lib/tiendaLegal')>()), useLegalTienda: () => null }))

const categorias = { categorias: [{ id: 'c-1', nombre: 'Joysticks', padreId: null, productos: 3, imagen: null }] }

// F-TDA-16 (FR-010): «Escribinos» del pie enlaza a /contacto. «Contacto» del encabezado (MSF-841) se prueba en layout/tiendaDiseno.test.tsx.
describe('enlaces a /contacto', () => {
  it('«Escribinos» del pie lleva a /contacto, con o sin categorías', () => {
    const { unmount } = render(<MemoryRouter><PieCategorias empresaNombre="Mundo JC" categorias={categorias.categorias} host="tienda.ejemplo.com" /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Escribinos' })).toHaveAttribute('href', '/contacto')
    unmount()
    render(<MemoryRouter><PieCategorias empresaNombre="Mundo JC" categorias={[]} host="tienda.ejemplo.com" /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Escribinos' })).toHaveAttribute('href', '/contacto')
    expect(screen.queryByTestId('pie-categorias')).not.toBeInTheDocument()
  })
})
