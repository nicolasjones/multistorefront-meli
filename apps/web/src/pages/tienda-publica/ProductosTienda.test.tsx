import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../test/axe'

const mocks = vi.hoisted(() => ({ leer: vi.fn() }))

vi.mock('../../lib/tiendaCatalogo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/tiendaCatalogo')>()),
  leerCatalogoPublico: mocks.leer,
}))

import ProductosTienda from './secciones/ProductosTienda'

// F-TDA-04 (FR-049): la sección pública solo pinta lo que devuelve la función pública. Vive fuera
// de `secciones/` porque esa carpeta se carga con import.meta.glob.

const tienda = { tiendaId: 't-1', empresaNombre: 'Mundo JC', estado: 'publicada' }

const catalogo = {
  categorias: [{ id: 'c-1', nombre: 'Consolas', padreId: null }],
  productos: [
    { id: 'p-1', nombre: 'Joystick', moneda: 'USD', precio: 49.9, tieneImagen: false, categoriaId: 'c-1', destacado: true },
    { id: 'p-2', nombre: 'Cable', moneda: 'USD', precio: 10, tieneImagen: false, categoriaId: null, destacado: false },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ProductosTienda (FR-049)', () => {
  it('muestra los productos en el orden de la función pública, con el destacado marcado', async () => {
    mocks.leer.mockResolvedValue(catalogo)
    render(<ProductosTienda tienda={tienda} host="mundojc.localhost" />)

    const items = await screen.findAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual(['JoystickDestacadoUSD 49,90', 'CableUSD 10,00'])
    expect(mocks.leer).toHaveBeenCalledWith('mundojc.localhost')
  })

  it('no pinta nada si la tienda no tiene productos visibles o el dominio no resuelve', async () => {
    mocks.leer.mockResolvedValue({ categorias: [], productos: [] })
    const { container, rerender } = render(<ProductosTienda tienda={tienda} host="mundojc.localhost" />)
    await vi.waitFor(() => expect(mocks.leer).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()

    mocks.leer.mockResolvedValue(null)
    rerender(<ProductosTienda tienda={tienda} host="otro.localhost" />)
    await vi.waitFor(() => expect(mocks.leer).toHaveBeenCalledWith('otro.localhost'))
    expect(container).toBeEmptyDOMElement()
  })

  it('avisa si no pudo cargar los productos', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.leer.mockRejectedValue(new Error('boom'))
    render(<ProductosTienda tienda={tienda} host="mundojc.localhost" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos cargar los productos.')
  })

  it.each([320, 768, 1440])('no tiene violaciones de axe a %i px', async (ancho) => {
    window.innerWidth = ancho
    mocks.leer.mockResolvedValue(catalogo)
    const { container } = render(<ProductosTienda tienda={tienda} host="mundojc.localhost" />)
    await screen.findAllByRole('listitem')
    expect(await violacionesAxe(container)).toEqual([])
  })
})
