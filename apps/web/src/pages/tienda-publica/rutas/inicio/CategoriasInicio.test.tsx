import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../../test/axe'
import { HOST, categorias, destacados, mocks, responder, tienda } from './apoyo'

vi.mock('../../../../lib/supabase', async () => {
  const { mocks: m } = await import('./apoyo')
  return { supabaseClient: { schema: () => ({ rpc: m.rpc }) } }
})
const firmar = vi.hoisted(() => vi.fn())
vi.mock('../../../../lib/imagenProducto', () => ({ urlsImagenesProducto: firmar }))

import CategoriasInicio from '../../secciones/CategoriasInicio'

const montar = () => render(<MemoryRouter><CategoriasInicio tienda={tienda} host={HOST} /></MemoryRouter>)

// F-TDA-10 (FR-003, SC-002): una tarjeta por categoría visible con «N productos», que enlaza al listado.
describe('CategoriasInicio', () => {
  beforeEach(() => { vi.clearAllMocks(); firmar.mockResolvedValue({}) })

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
    // Se espera al desenlace (el bloque desaparece al llegar los destacados) y solo después se mira el pedido.
    await waitFor(() => expect(container).toBeEmptyDOMElement())
    expect(mocks.rpc).toHaveBeenCalledWith('destacados_por_dominio', { host: HOST })
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

  // MSF-841: foto de la categoría (la de un producto suyo); sin foto, el recuadro neutro.
  it('muestra la foto de la categoría (URL firmada, una sola llamada) y deja el recuadro neutro si no hay', async () => {
    firmar.mockResolvedValue({ 'o/cat/c-1.png': 'https://firmada.test/a.png' })
    responder({
      categorias_por_dominio: { data: { categorias: [
        { id: 'c-1', nombre: 'Joysticks', padre_id: null, productos: 3, imagen: 'o/cat/c-1.png' },
        { id: 'c-2', nombre: 'Cargadores', padre_id: null, productos: 1, imagen: null },
        { id: 'c-3', nombre: 'Cables', padre_id: null, productos: 1 },
      ] } },
      destacados_por_dominio: { data: destacados },
    })
    const { container } = montar()
    await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src', 'https://firmada.test/a.png'))
    expect(container.querySelectorAll('img')).toHaveLength(1)
    expect(screen.getAllByTestId('foto-categoria')).toHaveLength(3)
    // Una sola llamada para las categorías (los destacados firman las suyas aparte).
    expect(firmar.mock.calls.filter(([rutas]) => (rutas as string[]).includes('o/cat/c-1.png'))).toEqual([[['o/cat/c-1.png']]])
    expect(await violacionesAxe(container)).toEqual([])
  })

  it('sin ninguna foto no pide firmar nada y las tarjetas conservan nombre y conteo', async () => {
    responder({ categorias_por_dominio: { data: categorias }, destacados_por_dominio: { data: destacados } })
    montar()
    await screen.findByText('3 productos')
    expect(firmar.mock.calls.flatMap(([rutas]) => rutas as string[]).filter((ruta) => ruta.includes('/cat/'))).toEqual([])
  })
})
