import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ resolver: vi.fn(), categorias: vi.fn() }))

vi.mock('../../lib/tienda', () => ({ resolverTienda: mocks.resolver }))
vi.mock('../../lib/tiendaCategorias', () => ({ leerCategoriasPublicas: mocks.categorias }))

import { TiendaPublicaApp } from './index'

describe('TiendaPublicaApp (FR-007, SC-004, SC-011)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.categorias.mockResolvedValue([])
  })

  it('muestra la tienda cuando el Host resuelve', async () => {
    mocks.resolver.mockResolvedValue({ tiendaId: 't-1', empresaNombre: 'Mundo JC', estado: 'publicada' })
    render(<TiendaPublicaApp host="mundojc.localhost" />)

    expect(await screen.findByRole('heading', { name: 'Mundo JC' })).toBeInTheDocument()
    expect(mocks.resolver).toHaveBeenCalledWith('mundojc.localhost')
  })

  it('muestra «Volvemos pronto» para un dominio desconocido o una tienda desactivada', async () => {
    mocks.resolver.mockResolvedValue(null)
    render(<TiendaPublicaApp host="no-existe.test" />)

    expect(await screen.findByRole('heading', { name: 'Volvemos pronto' })).toBeInTheDocument()
  })

  it('ante un error de red ofrece reintentar y no lo disfraza de «Volvemos pronto»', async () => {
    mocks.resolver.mockRejectedValueOnce(new Error('sin red')).mockResolvedValueOnce({ tiendaId: 't-1', empresaNombre: 'Mundo JC', estado: 'publicada' })
    render(<TiendaPublicaApp host="mundojc.localhost" />)

    expect(await screen.findByText('No pudimos cargar la tienda.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Volvemos pronto' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('heading', { name: 'Mundo JC' })).toBeInTheDocument()
  })

  it('muestra el estado de carga mientras resuelve', () => {
    mocks.resolver.mockReturnValue(new Promise(() => {}))
    render(<TiendaPublicaApp host="mundojc.localhost" />)

    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
  })

  it('no muestra nada de la tienda anterior al cambiar de Host', async () => {
    mocks.resolver.mockResolvedValueOnce({ tiendaId: 't-1', empresaNombre: 'Mundo JC', estado: 'publicada' })
    const { rerender } = render(<TiendaPublicaApp host="mundojc.localhost" />)
    expect(await screen.findByRole('heading', { name: 'Mundo JC' })).toBeInTheDocument()

    mocks.resolver.mockResolvedValueOnce({ tiendaId: 't-2', empresaNombre: 'San Javucho', estado: 'publicada' })
    rerender(<TiendaPublicaApp host="sanjavucho.localhost" />)

    expect(await screen.findByRole('heading', { name: 'San Javucho' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Mundo JC' })).not.toBeInTheDocument())
  })
})
