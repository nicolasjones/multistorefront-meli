import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../../test/axe'
import { celular } from '../../../../test/matchMedia'
import { HOST, categorias, destacados, responder, tienda } from './apoyo'

vi.mock('../../../../lib/supabase', async () => {
  const { mocks: m } = await import('./apoyo')
  return { supabaseClient: { schema: () => ({ rpc: m.rpc }) } }
})
vi.mock('../../../../lib/imagenProducto', () => ({ urlsImagenesProducto: async () => ({}) }))

import CategoriasInicio from '../../secciones/CategoriasInicio'
import DestacadosInicio from '../../secciones/DestacadosInicio'

// MSF-847 (MH-05, prototipo `MJC_M_Home`): en celular las categorías son píldoras con «Todo» activa y filtran los destacados en su lugar.
const montar = () => render(<MemoryRouter><main><h1>Tienda</h1><CategoriasInicio tienda={tienda} host={HOST} /><DestacadosInicio tienda={tienda} host={HOST} /></main></MemoryRouter>)

describe('Portada en celular: píldoras de categoría', () => {
  beforeEach(() => { vi.clearAllMocks(); celular(true) })
  afterEach(() => { Reflect.deleteProperty(window, 'matchMedia') })

  it('«Todo» arranca activa y elegir una categoría filtra los destacados y cambia el título; «Todo» los restaura', async () => {
    responder({ categorias_por_dominio: { data: categorias }, destacados_por_dominio: { data: destacados } })
    const { container } = montar()
    const todo = await screen.findByRole('button', { name: 'Todo' })
    expect(todo).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByRole('heading', { level: 2, name: 'Destacados' })).toBeInTheDocument()
    expect(screen.getAllByTestId('tarjeta-producto')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Joysticks' }))
    expect(screen.getByRole('button', { name: 'Joysticks' })).toHaveAttribute('aria-pressed', 'true')
    expect(todo).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('heading', { level: 2, name: 'Joysticks' })).toBeInTheDocument()
    expect(screen.getAllByTestId('tarjeta-producto')).toHaveLength(1)
    expect(await violacionesAxe(container)).toEqual([])

    // Una categoría sin destacados lleva a su listado (no se pierde el camino a la categoría).
    fireEvent.click(screen.getByRole('button', { name: 'Cargadores' }))
    expect(screen.queryByTestId('tarjeta-producto')).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Cargadores' })).getByRole('link', { name: 'Ver Cargadores' })).toHaveAttribute('href', '/categoria/c-2')

    fireEvent.click(screen.getByRole('button', { name: 'Todo' }))
    expect(screen.getAllByTestId('tarjeta-producto')).toHaveLength(2)
  })
})
