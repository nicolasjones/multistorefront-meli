import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../../test/axe'
import { HOST, categorias, destacados, mocks, responder, tienda } from './apoyo'

vi.mock('../../../../lib/supabase', async () => {
  const { mocks: m } = await import('./apoyo')
  return { supabaseClient: { schema: () => ({ rpc: m.rpc }) } }
})
vi.mock('../../../../lib/imagenProducto', () => ({ urlsImagenesProducto: async () => ({}) }))

import CategoriasInicio from '../../secciones/CategoriasInicio'

const montar = () => render(<MemoryRouter><CategoriasInicio tienda={tienda} host={HOST} /></MemoryRouter>)

// F-TDA-10 (FR-003, SC-002): una tarjeta por categoría visible con «N productos», que enlaza al listado.
describe('CategoriasInicio', () => {
  beforeEach(() => vi.clearAllMocks())

  it('muestra cada categoría con su cantidad (incluido 0 productos) y enlaza a su listado', async () => {
    responder({ categorias_por_dominio: { data: categorias }, destacados_por_dominio: { data: destacados } })
    const { container } = montar()

    const bloque = await screen.findByRole('region', { name: 'Categorías' })
    const enlaces = within(bloque).getAllByRole('link')
    expect(enlaces.map((e) => e.textContent)).toEqual(['Joysticks3 productos', 'Cargadores0 productos'])
    expect(enlaces[0]).toHaveAttribute('href', '/categoria/c-1')
    expect(await violacionesAxe(container)).toEqual([])
  })

  it('se oculta cuando la tienda no tiene productos visibles', async () => {
    responder({ categorias_por_dominio: { data: categorias }, destacados_por_dominio: { data: { hay_productos: false, productos: [] } } })
    const { container } = montar()
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('destacados_por_dominio', { host: HOST }))
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('un error propio se muestra en el bloque con «Reintentar»', async () => {
    responder({ categorias_por_dominio: { error: { message: 'caído' } }, destacados_por_dominio: { data: destacados } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    montar()
    expect(await screen.findByText('No pudimos cargar las categorías.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })

  it('no oculta las categorías si solo falla el dato de preparación', async () => {
    responder({ categorias_por_dominio: { data: categorias }, destacados_por_dominio: { error: { message: 'caído' } } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    montar()
    expect(await screen.findByText('Joysticks')).toBeInTheDocument()
  })
})
