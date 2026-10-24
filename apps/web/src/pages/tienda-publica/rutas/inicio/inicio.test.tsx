import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../../test/axe'
import { HOST, categorias, destacados, mocks, responder, tienda } from './apoyo'

vi.mock('../../../../lib/supabase', async () => {
  const { mocks: m } = await import('./apoyo')
  return { supabaseClient: { schema: () => ({ rpc: m.rpc }) } }
})
vi.mock('../../../../lib/imagenProducto', () => ({ urlsImagenesProducto: async () => ({}) }))
vi.mock('../../../../lib/tiendaContenido', async (original) => ({
  ...(await original<typeof import('../../../../lib/tiendaContenido')>()),
  leerContenidoPublico: async () => ({
    ...(await original<typeof import('../../../../lib/tiendaContenido')>()).CONTENIDO_VACIO,
    titulo: 'Todo para tu consola',
    texto_boton: 'Ver catálogo',
  }),
}))

import { PaginaTienda } from '../../PaginaTienda'

const montar = () => render(<MemoryRouter><main><PaginaTienda tienda={tienda} host={HOST} /></main></MemoryRouter>)
const titulos = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)

// F-TDA-10 (FR-002, FR-006, FR-007, SC-002): composición de la home con las secciones reales.
describe('Home de la tienda', () => {
  beforeEach(() => vi.clearAllMocks())

  it('compone banner → Categorías → Destacados, sin h1 propio', async () => {
    responder({ categorias_por_dominio: { data: categorias }, destacados_por_dominio: { data: destacados } })
    const { container } = montar()

    await screen.findByText('Joystick Pro')
    expect(titulos()).toEqual(['Todo para tu consola', 'Categorías', 'Destacados'])
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver catálogo' })).toBeInTheDocument()
    expect(await violacionesAxe(container)).toEqual([])
  })

  it('tienda sin productos visibles: «Catálogo en preparación» en lugar de los bloques', async () => {
    responder({ categorias_por_dominio: { data: categorias }, destacados_por_dominio: { data: { hay_productos: false, productos: [] } } })
    montar()

    await screen.findByText('Catálogo en preparación')
    expect(titulos()).toEqual(['Todo para tu consola', 'Catálogo en preparación'])
    expect(screen.queryByText('Categorías')).not.toBeInTheDocument()
    expect(screen.queryByText('Destacados')).not.toBeInTheDocument()
  })

  it('con productos pero sin destacados solo se oculta «Destacados»', async () => {
    responder({ categorias_por_dominio: { data: categorias }, destacados_por_dominio: { data: { hay_productos: true, productos: [] } } })
    montar()

    await screen.findByText('Joysticks')
    expect(titulos()).toEqual(['Todo para tu consola', 'Categorías'])
    expect(screen.queryByText('Catálogo en preparación')).not.toBeInTheDocument()
  })

  it('un bloque que falla no rompe el resto', async () => {
    responder({ categorias_por_dominio: { data: categorias }, destacados_por_dominio: { error: { message: 'caído' } } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    montar()

    expect(await screen.findByText('No pudimos cargar los destacados.')).toBeInTheDocument()
    expect(screen.getByText('Joysticks')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Todo para tu consola' })).toBeInTheDocument()
  })

  it('pide los destacados una sola vez aunque lo usen tres bloques', async () => {
    responder({ categorias_por_dominio: { data: categorias }, destacados_por_dominio: { data: destacados } })
    montar()
    await screen.findByText('Joystick Pro')
    expect(mocks.rpc.mock.calls.filter(([nombre]) => nombre === 'destacados_por_dominio')).toHaveLength(1)
  })
})
