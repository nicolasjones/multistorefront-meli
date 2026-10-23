import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../test/axe'

const mocks = vi.hoisted(() => ({ leer: vi.fn(), firmar: vi.fn() }))

vi.mock('../../lib/tiendaListado', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/tiendaListado')>()),
  leerPaginaCatalogo: mocks.leer,
}))
vi.mock('../../lib/imagenProducto', () => ({ urlsImagenesProducto: mocks.firmar }))

import ListadoProductos from './secciones-catalogo/ListadoProductos'

// F-TDA-12 (SC-005): restauración desde la URL, vuelta a página 1, valores inválidos ignorados, estado
// vacío, tarjeta «Sin imagen», paginación, ordenar y filtrar. Vive fuera de `secciones-catalogo/`
// porque esa carpeta se carga con import.meta.glob.

const tienda = { tiendaId: 't-1', empresaNombre: 'Mundo JC', estado: 'publicada' }
const HOST = 'mundojc.localhost'
const CAT_A = 'ca000000-0000-4000-8000-00000000000a'
const CAT_B = 'ca000000-0000-4000-8000-00000000000b'

const categorias = [
  { id: CAT_A, nombre: 'Joysticks', padreId: null, productos: 3 },
  { id: CAT_B, nombre: 'Cargadores', padreId: null, productos: 1 },
]

function pagina(sobrescribe: Record<string, unknown> = {}) {
  return {
    total: 2,
    pagina: 1,
    tamano: 24,
    categorias,
    productos: [
      { id: 'p-1', nombre: 'Joystick <b>Pro</b>', precio: 18455, disponible: true, imagen: 'org/p-1/a.png', categoriaId: CAT_A, destacado: true },
      { id: 'p-2', nombre: 'Cargador', precio: null, disponible: false, imagen: null, categoriaId: CAT_B, destacado: false },
    ],
    ...sobrescribe,
  }
}

function Ubicacion() {
  const { pathname, search } = useLocation()
  return <p data-testid="ubicacion">{pathname}{search}</p>
}

function montar(entrada: string, categoriaId: string | null = null, host = HOST) {
  const ui = (h: string) => (
    <MemoryRouter initialEntries={[entrada]}>
      <Routes>
        <Route
          path="*"
          element={<><ListadoProductos tienda={tienda} host={h} categoriaId={categoriaId} /><Ubicacion /></>}
        />
      </Routes>
    </MemoryRouter>
  )
  const resultado = render(ui(host))
  return { ...resultado, rerenderHost: (h: string) => resultado.rerender(ui(h)) }
}

const ubicacion = () => screen.getByTestId('ubicacion').textContent

beforeEach(() => {
  vi.clearAllMocks()
  mocks.leer.mockResolvedValue(pagina())
  mocks.firmar.mockResolvedValue({ 'org/p-1/a.png': 'https://firmada.test/a.png' })
})

describe('ListadoProductos · URL', () => {
  it('restaura filtros, orden y página desde la URL', async () => {
    montar(`/catalogo?categoria=${CAT_A}&stock=1&max=5000&orden=precio_asc&pagina=2`)
    await screen.findAllByTestId('tarjeta-producto')
    expect(mocks.leer).toHaveBeenCalledWith(HOST, { categoria: CAT_A, soloConStock: true, precioMax: 5000, orden: 'precio_asc', pagina: 2 })
    expect(screen.getByRole('button', { name: 'Solo con stock' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('textbox', { name: 'Precio máximo' })).toHaveValue('5000')
    expect(screen.getByRole('combobox', { name: 'Ordenar por' })).toHaveTextContent('Menor precio')
  })

  it('ignora valores inválidos y pide la lista inicial', async () => {
    montar('/catalogo?categoria=xx&stock=quizas&max=-3&orden=raro&pagina=0')
    await screen.findAllByTestId('tarjeta-producto')
    expect(mocks.leer).toHaveBeenCalledWith(HOST, { categoria: null, soloConStock: false, precioMax: null, orden: 'relevancia', pagina: 1 })
  })

  it('cambiar un filtro vuelve a la página 1 y actualiza la URL', async () => {
    montar('/catalogo?pagina=3')
    await screen.findAllByTestId('tarjeta-producto')
    fireEvent.click(screen.getByRole('button', { name: 'Solo con stock' }))
    expect(ubicacion()).toBe('/catalogo?stock=1')
    await vi.waitFor(() => expect(mocks.leer).toHaveBeenLastCalledWith(HOST, expect.objectContaining({ soloConStock: true, pagina: 1 })))
  })

  it('el precio máximo se aplica al salir del campo; vacío o inválido es «Sin límite»', async () => {
    montar('/catalogo?max=800')
    await screen.findAllByTestId('tarjeta-producto')
    const campo = screen.getByRole('textbox', { name: 'Precio máximo' })
    fireEvent.change(campo, { target: { value: '1.500' } })
    fireEvent.blur(campo)
    expect(ubicacion()).toBe('/catalogo?max=1500')
    fireEvent.change(campo, { target: { value: 'abc' } })
    fireEvent.blur(campo)
    expect(ubicacion()).toBe('/catalogo')
    expect(campo).toHaveValue('')
  })

  it('ordenar cambia la URL y vuelve a la página 1', async () => {
    montar('/catalogo?pagina=2')
    await screen.findAllByTestId('tarjeta-producto')
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Ordenar por' }))
    const opciones = within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)
    expect(opciones).toEqual(['Más relevantes', 'Menor precio', 'Mayor precio'])
    fireEvent.click(screen.getByRole('option', { name: 'Mayor precio' }))
    expect(ubicacion()).toBe('/catalogo?orden=precio_desc')
  })

  it('«Limpiar filtros» deja la URL sin filtros, también la categoría', async () => {
    montar(`/catalogo?categoria=${CAT_A}&stock=1&max=900&orden=precio_asc&pagina=2`)
    await screen.findAllByTestId('tarjeta-producto')
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    expect(ubicacion()).toBe('/catalogo')
  })
})

describe('ListadoProductos · categorías', () => {
  it('en /catalogo elegir una categoría la pone en la query y «Todos los productos» la quita', async () => {
    montar('/catalogo?stock=1')
    await screen.findAllByTestId('tarjeta-producto')
    const panel = screen.getByRole('navigation', { name: 'Filtrar por categoría' })
    expect(within(panel).getByText('Joysticks')).toBeInTheDocument()
    expect(within(panel).getByLabelText('3 productos')).toBeInTheDocument()
    fireEvent.click(within(panel).getByRole('button', { name: /Cargadores/ }))
    expect(ubicacion()).toBe(`/catalogo?categoria=${CAT_B}&stock=1`)
    fireEvent.click(within(panel).getByRole('button', { name: 'Todos los productos' }))
    expect(ubicacion()).toBe('/catalogo?stock=1')
  })

  it('en /categoria/:id la categoría va fija en el path y se pide al servidor', async () => {
    montar(`/categoria/${CAT_A}?orden=precio_asc`, CAT_A)
    await screen.findAllByTestId('tarjeta-producto')
    expect(mocks.leer).toHaveBeenCalledWith(HOST, expect.objectContaining({ categoria: CAT_A, orden: 'precio_asc' }))
    const panel = screen.getByRole('navigation', { name: 'Filtrar por categoría' })
    expect(within(panel).getByRole('button', { name: /Joysticks/ })).toHaveAttribute('aria-current', 'true')
    fireEvent.click(within(panel).getByRole('button', { name: /Cargadores/ }))
    expect(ubicacion()).toBe(`/categoria/${CAT_B}?orden=precio_asc`)
    fireEvent.click(within(panel).getByRole('button', { name: 'Todos los productos' }))
    expect(ubicacion()).toBe('/catalogo?orden=precio_asc')
  })
})

describe('ListadoProductos · resultados', () => {
  it('muestra tarjetas con precio, disponibilidad, «Sin imagen» y el texto escapado', async () => {
    montar('/catalogo')
    const tarjetas = await screen.findAllByTestId('tarjeta-producto')
    expect(tarjetas).toHaveLength(2)
    expect(tarjetas[0]).toHaveAttribute('href', '/producto/p-1')
    expect(within(tarjetas[0]).getByText('Joystick <b>Pro</b>')).toBeInTheDocument()
    expect(within(tarjetas[0]).getByText('$ 18.455')).toBeInTheDocument()
    expect(within(tarjetas[0]).getByText('Disponible')).toBeInTheDocument()
    expect(tarjetas[0].querySelector('img')).toHaveAttribute('src', 'https://firmada.test/a.png')
    expect(tarjetas[0].querySelector('img')).toHaveAttribute('loading', 'lazy')
    // Sin imagen, sin precio calculable y sin stock.
    expect(within(tarjetas[1]).getByText('Sin imagen')).toBeInTheDocument()
    expect(within(tarjetas[1]).getByText('Sin stock')).toBeInTheDocument()
    expect(within(tarjetas[1]).queryByText(/\$/)).not.toBeInTheDocument()
    expect(screen.getByTestId('catalogo-contador')).toHaveTextContent('2 productos')
  })

  it('una imagen que no se pudo firmar cae en «Sin imagen»', async () => {
    mocks.firmar.mockResolvedValue({})
    montar('/catalogo')
    const tarjetas = await screen.findAllByTestId('tarjeta-producto')
    expect(within(tarjetas[0]).getByText('Sin imagen')).toBeInTheDocument()
  })

  it('sin resultados muestra «No encontramos productos» y «Limpiar filtros» los quita', async () => {
    mocks.leer.mockResolvedValue(pagina({ total: 0, productos: [] }))
    montar('/catalogo?stock=1&max=10')
    expect(await screen.findByText('No encontramos productos')).toBeInTheDocument()
    expect(screen.getByText('Probá con otra categoría o quitá el filtro de stock.')).toBeInTheDocument()
    expect(screen.getByTestId('catalogo-contador')).toHaveTextContent('0 productos')
    fireEvent.click(within(screen.getByTestId('catalogo-vacio')).getByRole('button', { name: 'Limpiar filtros' }))
    expect(ubicacion()).toBe('/catalogo')
  })

  it('con 1 producto el contador va en singular', async () => {
    mocks.leer.mockResolvedValue(pagina({ total: 1, productos: pagina().productos.slice(0, 1) }))
    montar('/catalogo')
    await screen.findAllByTestId('tarjeta-producto')
    expect(screen.getByTestId('catalogo-contador')).toHaveTextContent(/^1 producto$/)
  })

  it('pagina de a 24 con enlaces que conservan los filtros', async () => {
    mocks.leer.mockResolvedValue(pagina({ total: 50, pagina: 2 }))
    montar('/catalogo?stock=1&pagina=2')
    await screen.findAllByTestId('tarjeta-producto')
    const nav = screen.getByRole('navigation', { name: 'Paginación del catálogo' })
    expect(within(nav).getByRole('link', { name: 'Página 2, página actual' })).toHaveAttribute('href', '/catalogo?stock=1&pagina=2')
    expect(within(nav).getByRole('link', { name: 'Ir a la página 3' })).toHaveAttribute('href', '/catalogo?stock=1&pagina=3')
    expect(within(nav).getByRole('link', { name: 'Ir a la página 1' })).toHaveAttribute('href', '/catalogo?stock=1')
    expect(within(nav).queryByRole('link', { name: 'Ir a la página 4' })).not.toBeInTheDocument()
    fireEvent.click(within(nav).getByRole('link', { name: 'Ir a la página 3' }))
    expect(ubicacion()).toBe('/catalogo?stock=1&pagina=3')
  })

  it('con una sola página no dibuja la paginación', async () => {
    montar('/catalogo')
    await screen.findAllByTestId('tarjeta-producto')
    expect(screen.queryByRole('navigation', { name: 'Paginación del catálogo' })).not.toBeInTheDocument()
  })
})

describe('ListadoProductos · estados', () => {
  it('muestra la carga y no deja resultados de otro host', async () => {
    const { rerenderHost } = montar('/catalogo')
    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
    await screen.findAllByTestId('tarjeta-producto')
    mocks.leer.mockReturnValue(new Promise(() => undefined))
    rerenderHost('sanjavucho.localhost')
    expect(screen.queryByTestId('tarjeta-producto')).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
    expect(mocks.leer).toHaveBeenLastCalledWith('sanjavucho.localhost', expect.anything())
  })

  it('avisa si falla y permite reintentar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.leer.mockRejectedValueOnce(new Error('boom'))
    montar('/catalogo')
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos cargar los productos.')
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findAllByTestId('tarjeta-producto')).toHaveLength(2)
  })

  it.each([320, 768, 1440])('no tiene violaciones de axe a %i px', async (ancho) => {
    window.innerWidth = ancho
    mocks.leer.mockResolvedValue(pagina({ total: 50 }))
    const { container } = montar('/catalogo?stock=1')
    await screen.findAllByTestId('tarjeta-producto')
    expect(await violacionesAxe(container)).toEqual([])
  })

  it('el estado vacío no tiene violaciones de axe', async () => {
    mocks.leer.mockResolvedValue(pagina({ total: 0, productos: [] }))
    const { container } = montar('/catalogo')
    await screen.findByText('No encontramos productos')
    expect(await violacionesAxe(container)).toEqual([])
  })
})
