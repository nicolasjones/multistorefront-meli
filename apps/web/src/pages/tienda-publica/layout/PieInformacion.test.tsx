import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../test/axe'

const mocks = vi.hoisted(() => ({ leerEnlaces: vi.fn() }))

vi.mock('../../../lib/tiendaPaginas', async (original) => ({
  ...(await original<typeof import('../../../lib/tiendaPaginas')>()),
  leerEnlacesPaginas: mocks.leerEnlaces,
}))

import { PieCategorias } from './PieCategorias'
import { PieInformacion } from './PieInformacion'

const montar = () =>
  render(
    <MemoryRouter>
      <PieInformacion host="mundojc.localhost" />
    </MemoryRouter>,
  )

describe('columna «Información» del pie (FR-007, SC-002)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('lista un enlace por página visible hacia /pagina/<slug>', async () => {
    mocks.leerEnlaces.mockResolvedValue([
      { titulo: 'Cómo comprar', slug: 'como-comprar' },
      { titulo: 'Envíos', slug: 'envios' },
    ])
    const { container } = montar()

    expect(await screen.findByRole('heading', { name: 'Información' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Envíos' })).toHaveAttribute('href', '/pagina/envios')
    expect(screen.getByRole('link', { name: 'Cómo comprar' })).toHaveAttribute('href', '/pagina/como-comprar')
    expect(mocks.leerEnlaces).toHaveBeenCalledWith('mundojc.localhost')
    expect(await violacionesAxe(container)).toEqual([])
  })

  it('sin páginas visibles no aparece la columna', async () => {
    mocks.leerEnlaces.mockResolvedValue([])
    const { container } = montar()

    await waitFor(() => expect(mocks.leerEnlaces).toHaveBeenCalled())
    expect(screen.queryByRole('heading', { name: 'Información' })).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  it('host desconocido (null) o falla del pedido: falla en silencio, sin columna ni error', async () => {
    mocks.leerEnlaces.mockRejectedValueOnce(new Error('sin red'))
    const { container } = montar()

    await waitFor(() => expect(console.error).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('PieCategorias monta la columna junto a Contacto cuando recibe el host', async () => {
    mocks.leerEnlaces.mockResolvedValue([{ titulo: 'Envíos', slug: 'envios' }])
    render(
      <MemoryRouter>
        <PieCategorias empresaNombre="Mundo JC" categorias={[]} host="mundojc.localhost" />
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('pie-informacion')).toBeInTheDocument()
    expect(screen.getByTestId('pie-contacto')).toBeInTheDocument()
  })

  it('tolera el tope de 50 páginas: muestra las 50 y no más aunque la respuesta traiga de más', async () => {
    mocks.leerEnlaces.mockResolvedValue(Array.from({ length: 60 }, (_, i) => ({ titulo: `Página ${i + 1}`, slug: `pagina-${i + 1}` })))
    const { container } = montar()

    expect(await screen.findByRole('heading', { name: 'Información' })).toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(50)
    expect(screen.queryByRole('link', { name: 'Página 51' })).not.toBeInTheDocument()
    expect(await violacionesAxe(container)).toEqual([])
  })
})
