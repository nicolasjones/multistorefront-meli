import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../../test/axe'
import { HOST, destacados, mocks, responder, tienda } from './apoyo'

vi.mock('../../../../lib/supabase', async () => {
  const { mocks: m } = await import('./apoyo')
  return { supabaseClient: { schema: () => ({ rpc: m.rpc }) } }
})
vi.mock('../../../../lib/imagenProducto', () => ({
  urlsImagenesProducto: async (rutas: string[]) => Object.fromEntries(rutas.map((r) => [r, `https://img.test/${r}`])),
}))

import DestacadosInicio from '../../secciones/DestacadosInicio'

const montar = () => render(<MemoryRouter><DestacadosInicio tienda={tienda} host={HOST} /></MemoryRouter>)

// F-TDA-10 (FR-004, FR-005, SC-002): tarjetas con el precio final y la disponibilidad, y el acceso al catálogo.
describe('DestacadosInicio', () => {
  beforeEach(() => vi.clearAllMocks())

  it('muestra precio final, disponibilidad e imagen, y enlaza al catálogo', async () => {
    responder({ destacados_por_dominio: { data: destacados } })
    const { container } = montar()

    const tarjetas = await screen.findAllByTestId('tarjeta-producto')
    expect(tarjetas).toHaveLength(2)
    expect(within(tarjetas[0]).getByText('Joystick Pro')).toBeInTheDocument()
    expect(within(tarjetas[0]).getByText('$ 18.455')).toBeInTheDocument()
    expect(within(tarjetas[0]).getByText('Disponible')).toBeInTheDocument()
    expect(tarjetas[0].querySelector('img')).toHaveAttribute('src', 'https://img.test/o/p-1/a.png')
    expect(tarjetas[0]).toHaveAttribute('href', '/producto/p-1')
    expect(screen.getByRole('link', { name: 'Ver todo el catálogo →' })).toHaveAttribute('href', '/catalogo')
    expect(await violacionesAxe(container)).toEqual([])
  })

  it('sin precio calculable no muestra precio, y el texto se escapa', async () => {
    responder({ destacados_por_dominio: { data: destacados } })
    montar()
    const tarjetas = await screen.findAllByTestId('tarjeta-producto')
    expect(within(tarjetas[1]).getByText('<b>Cable</b>')).toBeInTheDocument()
    expect(within(tarjetas[1]).getByText('Sin stock')).toBeInTheDocument()
    expect(within(tarjetas[1]).getByText('Sin imagen')).toBeInTheDocument()
    expect(tarjetas[1].textContent).not.toContain('$')
  })

  it('sin destacados el bloque no se muestra', async () => {
    responder({ destacados_por_dominio: { data: { hay_productos: true, productos: [] } } })
    const { container } = montar()
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalled())
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('host desconocido (null): no se muestra y no hay error', async () => {
    responder({ destacados_por_dominio: { data: null } })
    const { container } = montar()
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('un error se muestra en el bloque con «Reintentar»', async () => {
    responder({ destacados_por_dominio: { error: { message: 'caído' } } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    montar()
    expect(await screen.findByText('No pudimos cargar los destacados.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })
})
