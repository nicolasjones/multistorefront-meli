import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../test/axe'

const mocks = vi.hoisted(() => ({ leer: vi.fn(), buscar: vi.fn(), firmar: vi.fn() }))

vi.mock('../../lib/tiendaListado', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/tiendaListado')>()),
  leerPaginaCatalogo: mocks.leer,
}))
vi.mock('../../lib/tiendaBusqueda', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/tiendaBusqueda')>()),
  leerPaginaBusqueda: mocks.buscar,
}))
vi.mock('../../lib/imagenProducto', () => ({ urlsImagenesProducto: mocks.firmar }))

import ListadoProductos from './secciones-catalogo/ListadoProductos'

// F-TDA-12 (SC-005): restauración desde la URL, reinicio de la lista al cambiar filtros, valores inválidos ignorados, estado
// vacío, tarjeta «Sin imagen», carga infinita (MSF-845), ordenar y filtrar. Vive fuera de `secciones-catalogo/`
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

// IntersectionObserver de mentira: permite «llegar al final» a mano.
type Observador = { callback: IntersectionObserverCallback; activo: boolean }
let observadores: Observador[] = []
const llegarAlFinal = () => {
  const vivo = observadores.filter((o) => o.activo).at(-1)
  vivo?.callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
}

beforeEach(() => {
  vi.clearAllMocks()
  observadores = []
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      private readonly o: Observador
      constructor(callback: IntersectionObserverCallback) {
        this.o = { callback, activo: true }
        observadores.push(this.o)
      }
      observe() {}
      disconnect() { this.o.activo = false }
    },
  )
  mocks.leer.mockResolvedValue(pagina())
  mocks.firmar.mockResolvedValue({ 'org/p-1/a.png': 'https://firmada.test/a.png' })
})
afterEach(() => vi.unstubAllGlobals())

describe('ListadoProductos · URL', () => {
  it('restaura filtros y orden desde la URL e ignora un ?pagina= viejo', async () => {
    montar(`/catalogo?categoria=${CAT_A}&stock=1&max=5000&orden=precio_asc&pagina=2`)
    await screen.findAllByTestId('tarjeta-producto')
    expect(mocks.leer).toHaveBeenCalledWith(HOST, { categoria: CAT_A, soloConStock: true, precioMax: 5000, orden: 'precio_asc' }, 1)
    expect(screen.getByRole('button', { name: 'Solo con stock' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('textbox', { name: 'Precio máximo' })).toHaveValue('5000')
    expect(screen.getByRole('combobox', { name: 'Ordenar por' })).toHaveTextContent('Menor precio')
  })

  it('ignora valores inválidos y pide la lista inicial', async () => {
    montar('/catalogo?categoria=xx&stock=quizas&max=-3&orden=raro&pagina=0')
    await screen.findAllByTestId('tarjeta-producto')
    expect(mocks.leer).toHaveBeenCalledWith(HOST, { categoria: null, soloConStock: false, precioMax: null, orden: 'relevancia' }, 1)
  })

  it('cambiar un filtro reinicia desde la primera tanda y actualiza la URL', async () => {
    montar('/catalogo?pagina=3')
    await screen.findAllByTestId('tarjeta-producto')
    fireEvent.click(screen.getByRole('button', { name: 'Solo con stock' }))
    expect(ubicacion()).toBe('/catalogo?stock=1')
    await vi.waitFor(() => expect(mocks.leer).toHaveBeenLastCalledWith(HOST, expect.objectContaining({ soloConStock: true }), 1))
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

  it('conserva las categorías del panel mientras recarga', async () => {
    montar('/catalogo')
    await screen.findAllByTestId('tarjeta-producto')
    mocks.leer.mockReturnValue(new Promise(() => {}))
    fireEvent.click(screen.getByRole('button', { name: 'Solo con stock' }))
    await vi.waitFor(() => expect(screen.queryAllByTestId('tarjeta-producto')).toHaveLength(0))
    expect(screen.getByText('Joysticks')).toBeInTheDocument()
  })

  it('ordenar cambia la URL y reinicia desde la primera tanda', async () => {
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
    expect(within(panel).getAllByLabelText('3 productos').length).toBeGreaterThan(0)
    fireEvent.click(within(panel).getByRole('button', { name: /Cargadores/ }))
    expect(ubicacion()).toBe(`/catalogo?categoria=${CAT_B}&stock=1`)
    fireEvent.click(within(panel).getByRole('button', { name: /^Todos los productos/ }))
    expect(ubicacion()).toBe('/catalogo?stock=1')
  })

  it('en /categoria/:id la categoría va fija en el path y se pide al servidor', async () => {
    montar(`/categoria/${CAT_A}?orden=precio_asc`, CAT_A)
    await screen.findAllByTestId('tarjeta-producto')
    expect(mocks.leer).toHaveBeenCalledWith(HOST, expect.objectContaining({ categoria: CAT_A, orden: 'precio_asc' }), 1)
    const panel = screen.getByRole('navigation', { name: 'Filtrar por categoría' })
    expect(within(panel).getByRole('button', { name: /Joysticks/ })).toHaveAttribute('aria-current', 'true')
    fireEvent.click(within(panel).getByRole('button', { name: /Cargadores/ }))
    expect(ubicacion()).toBe(`/categoria/${CAT_B}?orden=precio_asc`)
    fireEvent.click(within(panel).getByRole('button', { name: /^Todos los productos/ }))
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
    expect(within(tarjetas[1]).getByTestId('tarjeta-sin-stock')).toHaveTextContent('Sin stock')
    expect(within(tarjetas[1]).queryByText(/\$/)).not.toBeInTheDocument()
    expect(screen.getByTestId('catalogo-contador')).toHaveTextContent('2 productos')
  })

  it('una imagen que no se pudo firmar cae en «Sin imagen»', async () => {
    mocks.firmar.mockResolvedValue({})
    montar('/catalogo')
    const tarjetas = await screen.findAllByTestId('tarjeta-producto')
    expect(within(tarjetas[0]).getByText('Sin imagen')).toBeInTheDocument()
  })

  it('una imagen cuya URL vence o falla al cargar cae en «Sin imagen»', async () => {
    montar('/catalogo')
    const tarjetas = await screen.findAllByTestId('tarjeta-producto')
    fireEvent.error(tarjetas[0].querySelector('img') as HTMLImageElement)
    expect(within(tarjetas[0]).getByText('Sin imagen')).toBeInTheDocument()
    expect(tarjetas[0].querySelector('img')).toBeNull()
  })

  it('sin resultados muestra «No hay productos con esos filtros» y «Limpiar filtros» los quita', async () => {
    mocks.leer.mockResolvedValue(pagina({ total: 0, productos: [] }))
    montar('/catalogo?stock=1&max=10')
    expect(await screen.findByText('No hay productos con esos filtros')).toBeInTheDocument()
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

  it('ya no dibuja paginación numerada', async () => {
    mocks.leer.mockResolvedValue(pagina({ total: 50 }))
    montar('/catalogo')
    await screen.findAllByTestId('tarjeta-producto')
    expect(screen.queryByRole('navigation', { name: /Paginación/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /página/i })).not.toBeInTheDocument()
  })
})

// MSF-845: carga infinita (IntersectionObserver + «Cargar más» por teclado, carga/error/fin, reinicio).
describe('ListadoProductos · carga infinita', () => {
  const prod = (n: number) => ({ id: `m-${n}`, nombre: `Masivo ${n}`, precio: 100 + n, disponible: true, imagen: null, categoriaId: CAT_A, destacado: false })
  const tanda = (desde: number, cantidad: number, total: number, numero: number) =>
    pagina({ total, pagina: numero, productos: Array.from({ length: cantidad }, (_, i) => prod(desde + i)) })
  const tarjetas = () => screen.queryAllByTestId('tarjeta-producto')

  it('arranca con la primera tanda, contador total y sin fin de lista mientras falta', async () => {
    mocks.leer.mockResolvedValue(tanda(1, 24, 30, 1))
    montar('/catalogo')
    await screen.findAllByTestId('tarjeta-producto')
    expect(tarjetas()).toHaveLength(24)
    expect(screen.getByTestId('catalogo-contador')).toHaveTextContent('30 productos')
    expect(screen.getByRole('button', { name: 'Cargar más' })).toBeInTheDocument()
    expect(screen.queryByText('No hay más resultados.')).not.toBeInTheDocument()
  })

  it('al llegar al final suma la tanda siguiente a lo ya mostrado y avisa el fin de lista', async () => {
    mocks.leer.mockImplementation((_h: string, _f: unknown, n: number) =>
      Promise.resolve(n === 1 ? tanda(1, 24, 30, 1) : tanda(25, 6, 30, 2)),
    )
    montar('/catalogo?stock=1')
    await screen.findAllByTestId('tarjeta-producto')
    llegarAlFinal()
    await vi.waitFor(() => expect(tarjetas()).toHaveLength(30))
    expect(mocks.leer).toHaveBeenLastCalledWith(HOST, expect.objectContaining({ soloConStock: true }), 2)
    expect(screen.getByText('No hay más resultados.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument()
    expect(screen.getByTestId('catalogo-contador')).toHaveTextContent('30 productos')
    // La URL no cambia al cargar más.
    expect(ubicacion()).toBe('/catalogo?stock=1')
  })

  it('«Cargar más» por teclado trae la tanda siguiente y muestra el estado de carga', async () => {
    let resolver: (v: unknown) => void = () => undefined
    mocks.leer.mockImplementation((_h: string, _f: unknown, n: number) =>
      n === 1 ? Promise.resolve(tanda(1, 24, 48, 1)) : new Promise((r) => { resolver = r }),
    )
    montar('/catalogo')
    await screen.findAllByTestId('tarjeta-producto')
    const boton = screen.getByRole('button', { name: 'Cargar más' })
    boton.focus()
    expect(boton).toHaveFocus()
    fireEvent.click(boton) // Enter/Espacio sobre un <button> disparan click.
    await vi.waitFor(() => expect(screen.getByTestId('carga-infinita-anuncio')).toHaveTextContent('Cargando más resultados'))
    expect(screen.getByRole('button', { name: 'Cargar más' })).toHaveAttribute('aria-busy', 'true')
    // El foco no cae al body mientras carga.
    expect(boton).toHaveFocus()
    // Una segunda petición mientras carga no se duplica.
    llegarAlFinal()
    expect(mocks.leer).toHaveBeenCalledTimes(2)
    resolver(tanda(25, 24, 48, 2))
    await vi.waitFor(() => expect(tarjetas()).toHaveLength(48))
    expect(screen.getByText('No hay más resultados.')).toBeInTheDocument()
  })

  it('si falla una tanda conserva lo cargado, avisa y permite reintentar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.leer.mockImplementation((_h: string, _f: unknown, n: number) =>
      n === 1 ? Promise.resolve(tanda(1, 24, 30, 1)) : Promise.reject(new Error('boom')),
    )
    montar('/catalogo')
    await screen.findAllByTestId('tarjeta-producto')
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos cargar más resultados.')
    expect(tarjetas()).toHaveLength(24)
    mocks.leer.mockImplementation((_h: string, _f: unknown, n: number) => Promise.resolve(tanda(25, 6, 30, n)))
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await vi.waitFor(() => expect(tarjetas()).toHaveLength(30))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('cambiar el filtro o el orden reinicia desde el principio y descarta lo acumulado', async () => {
    mocks.leer.mockImplementation((_h: string, f: { soloConStock: boolean; orden: string }, n: number) =>
      Promise.resolve(f.soloConStock || f.orden !== 'relevancia' ? tanda(100, 3, 3, n) : n === 1 ? tanda(1, 24, 30, 1) : tanda(25, 6, 30, 2)),
    )
    montar('/catalogo')
    await screen.findAllByTestId('tarjeta-producto')
    llegarAlFinal()
    await vi.waitFor(() => expect(tarjetas()).toHaveLength(30))
    fireEvent.click(screen.getByRole('button', { name: 'Solo con stock' }))
    await vi.waitFor(() => expect(mocks.leer).toHaveBeenLastCalledWith(HOST, expect.objectContaining({ soloConStock: true }), 1))
    await vi.waitFor(() => expect(tarjetas()).toHaveLength(3))
    expect(screen.getByTestId('catalogo-contador')).toHaveTextContent('3 productos')
    expect(screen.queryByText('Masivo 1')).not.toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Ordenar por' }))
    fireEvent.click(screen.getByRole('option', { name: 'Mayor precio' }))
    await vi.waitFor(() => expect(mocks.leer).toHaveBeenLastCalledWith(HOST, expect.objectContaining({ orden: 'precio_desc' }), 1))
  })

  it('un producto repetido entre tandas no se duplica', async () => {
    mocks.leer.mockImplementation((_h: string, _f: unknown, n: number) =>
      Promise.resolve(n === 1 ? tanda(1, 24, 30, 1) : tanda(24, 7, 30, 2)),
    )
    montar('/catalogo')
    await screen.findAllByTestId('tarjeta-producto')
    llegarAlFinal()
    await vi.waitFor(() => expect(tarjetas()).toHaveLength(30))
  })

  it('una tanda vacía con total mayor corta la carga en vez de pedir sin fin', async () => {
    mocks.leer.mockImplementation((_h: string, _f: unknown, n: number) =>
      Promise.resolve(n === 1 ? tanda(1, 24, 40, 1) : tanda(1, 0, 40, 2)),
    )
    montar('/catalogo')
    await screen.findAllByTestId('tarjeta-producto')
    llegarAlFinal()
    await screen.findByText('No hay más resultados.')
    expect(mocks.leer).toHaveBeenCalledTimes(2)
  })

  it('con la búsqueda (q) carga más desde la búsqueda y conserva q', async () => {
    mocks.buscar.mockImplementation((_h: string, _q: string, _f: unknown, n: number) =>
      Promise.resolve(n === 1 ? tanda(1, 24, 30, 1) : tanda(25, 6, 30, 2)),
    )
    montar('/catalogo?q=masivo')
    await screen.findAllByTestId('tarjeta-producto')
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
    await vi.waitFor(() => expect(tarjetas()).toHaveLength(30))
    expect(mocks.buscar).toHaveBeenLastCalledWith(HOST, 'masivo', expect.anything(), 2)
    expect(mocks.leer).not.toHaveBeenCalled()
    expect(ubicacion()).toBe('/catalogo?q=masivo')
  })

  it('en /categoria/:id carga más con la categoría fija', async () => {
    mocks.leer.mockImplementation((_h: string, _f: unknown, n: number) =>
      Promise.resolve(n === 1 ? tanda(1, 24, 30, 1) : tanda(25, 6, 30, 2)),
    )
    montar(`/categoria/${CAT_A}`, CAT_A)
    await screen.findAllByTestId('tarjeta-producto')
    llegarAlFinal()
    await vi.waitFor(() => expect(tarjetas()).toHaveLength(30))
    expect(mocks.leer).toHaveBeenLastCalledWith(HOST, expect.objectContaining({ categoria: CAT_A }), 2)
  })

  it('sin IntersectionObserver «Cargar más» sigue funcionando', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    mocks.leer.mockImplementation((_h: string, _f: unknown, n: number) =>
      Promise.resolve(n === 1 ? tanda(1, 24, 30, 1) : tanda(25, 6, 30, 2)),
    )
    montar('/catalogo')
    await screen.findAllByTestId('tarjeta-producto')
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
    await vi.waitFor(() => expect(tarjetas()).toHaveLength(30))
  })

  describe('respuestas tardías y reinicios', () => {
    // Deja la tanda 2 colgada para resolverla a mano cuando la consulta ya cambió.
    function colgarTanda2(nombre: (n: number) => ReturnType<typeof tanda>) {
      const pendientes: Array<(v: unknown) => void> = []
      mocks.leer.mockImplementation((_host: string, f: { soloConStock: boolean }, n: number) =>
        n === 1
          ? Promise.resolve(f.soloConStock ? tanda(500, 3, 3, 1) : nombre(1))
          : new Promise((r) => { pendientes.push(r) }),
      )
      return pendientes
    }

    it('cambiar de filtro con «Cargar más» en vuelo: la respuesta tardía no se cuela', async () => {
      const pendientes = colgarTanda2(() => tanda(1, 24, 48, 1))
      montar('/catalogo')
      await screen.findAllByTestId('tarjeta-producto')
      fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
      await vi.waitFor(() => expect(pendientes).toHaveLength(1))
      fireEvent.click(screen.getByRole('button', { name: 'Solo con stock' }))
      await vi.waitFor(() => expect(tarjetas()).toHaveLength(3))
      await act(async () => {
        pendientes[0](tanda(25, 24, 48, 2))
        await new Promise((r) => setTimeout(r, 20))
      })
      expect(tarjetas()).toHaveLength(3)
      expect(screen.queryByText('Masivo 30')).not.toBeInTheDocument()
      expect(screen.getByTestId('catalogo-contador')).toHaveTextContent('3 productos')
    })

    it('cambiar la búsqueda (q) con «Cargar más» en vuelo: la respuesta tardía no se cuela', async () => {
      const pendientes: Array<(v: unknown) => void> = []
      mocks.buscar.mockImplementation((_h: string, q: string, _f: unknown, n: number) =>
        n === 1 ? Promise.resolve(q === 'uno' ? tanda(1, 24, 48, 1) : tanda(700, 2, 2, 1)) : new Promise((r) => { pendientes.push(r) }),
      )
      function CambiarQ() {
        const navegar = useNavigate()
        return <button type="button" onClick={() => navegar('/catalogo?q=dos')}>ir a dos</button>
      }
      render(
        <MemoryRouter initialEntries={['/catalogo?q=uno']}>
          <Routes>
            <Route path="*" element={<><ListadoProductos tienda={tienda} host={HOST} categoriaId={null} /><CambiarQ /></>} />
          </Routes>
        </MemoryRouter>,
      )
      await screen.findAllByTestId('tarjeta-producto')
      fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
      await vi.waitFor(() => expect(pendientes).toHaveLength(1))
      fireEvent.click(screen.getByRole('button', { name: 'ir a dos' }))
      await vi.waitFor(() => expect(tarjetas()).toHaveLength(2))
      await act(async () => {
        pendientes[0](tanda(25, 24, 48, 2))
        await new Promise((r) => setTimeout(r, 20))
      })
      expect(tarjetas()).toHaveLength(2)
    })

    it('cambiar de host con «Cargar más» en vuelo: la respuesta tardía no se cuela', async () => {
      const pendientes = colgarTanda2(() => tanda(1, 24, 48, 1))
      const { rerenderHost } = montar('/catalogo')
      await screen.findAllByTestId('tarjeta-producto')
      fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
      await vi.waitFor(() => expect(pendientes).toHaveLength(1))
      mocks.leer.mockImplementation(() => Promise.resolve(tanda(900, 2, 2, 1)))
      rerenderHost('otra.localhost')
      await vi.waitFor(() => expect(tarjetas()).toHaveLength(2))
      await act(async () => {
        pendientes[0](tanda(25, 24, 48, 2))
        await new Promise((r) => setTimeout(r, 20))
      })
      expect(tarjetas()).toHaveLength(2)
    })

    it('A→B→A con «Cargar más» de la primera A en vuelo: esa respuesta tardía se descarta', async () => {
      const pendientes: Array<(v: unknown) => void> = []
      mocks.leer.mockImplementation((host: string, _f: unknown, n: number) =>
        n === 1
          ? Promise.resolve(host === HOST ? tanda(1, 24, 48, 1) : tanda(900, 2, 2, 1))
          : new Promise((r) => { pendientes.push(r) }),
      )
      const { rerenderHost } = montar('/catalogo')
      await screen.findAllByTestId('tarjeta-producto')
      fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
      await vi.waitFor(() => expect(pendientes).toHaveLength(1))
      rerenderHost('otra.localhost')
      await vi.waitFor(() => expect(tarjetas()).toHaveLength(2))
      rerenderHost(HOST)
      await vi.waitFor(() => expect(tarjetas()).toHaveLength(24))
      await act(async () => {
        pendientes[0](tanda(25, 24, 48, 2))
        await new Promise((r) => setTimeout(r, 20))
      })
      // Sigue en la primera tanda de A: la respuesta vieja de A no sumó filas.
      expect(tarjetas()).toHaveLength(24)
      expect(screen.getByRole('button', { name: 'Cargar más' })).toBeInTheDocument()
    })

    it('A→B→A rápido: al volver a A no se ve ni un render con la lista vieja acumulada', async () => {
      let resolverA2: (v: unknown) => void = () => undefined
      let llamadasA = 0
      mocks.leer.mockImplementation((host: string, _f: unknown, n: number) => {
        if (host !== HOST) return new Promise(() => undefined)
        if (n === 1) {
          llamadasA += 1
          return llamadasA === 1 ? Promise.resolve(tanda(1, 24, 48, 1)) : new Promise((r) => { resolverA2 = r })
        }
        return Promise.resolve(tanda(25, 24, 48, 2))
      })
      const { rerenderHost } = montar('/catalogo')
      await screen.findAllByTestId('tarjeta-producto')
      fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
      await vi.waitFor(() => expect(tarjetas()).toHaveLength(48))
      rerenderHost('otra.localhost')
      rerenderHost(HOST)
      // La primera A (48 productos acumulados) ya no vale: mientras la nueva A carga no hay tarjetas.
      expect(tarjetas()).toHaveLength(0)
      await act(async () => { resolverA2(tanda(1, 24, 48, 1)) })
      await vi.waitFor(() => expect(tarjetas()).toHaveLength(24))
    })

    it('tanda 2 de búsqueda con límite: aviso específico, sin firmar imágenes y «Reintentar» espera', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      mocks.buscar.mockImplementation((_h: string, _q: string, _f: unknown, n: number) =>
        Promise.resolve(n === 1 ? tanda(1, 24, 48, 1) : pagina({ productos: [], total: 48, pagina: 2, esperaSegundos: 1 })),
      )
      montar('/catalogo?q=masivo')
      await screen.findAllByTestId('tarjeta-producto')
      const firmadosAntes = mocks.firmar.mock.calls.length
      fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
      const alerta = await screen.findByRole('alert')
      expect(alerta).toHaveTextContent('Hiciste muchas búsquedas seguidas, esperá unos segundos y reintentá')
      expect(mocks.firmar.mock.calls.length).toBe(firmadosAntes)
      expect(tarjetas()).toHaveLength(24)
      expect(screen.getByRole('button', { name: 'Reintentar' })).toBeDisabled()
      mocks.buscar.mockImplementation((_h: string, _q: string, _f: unknown, n: number) => Promise.resolve(tanda(25, 24, 48, n)))
      await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Reintentar' })).toBeEnabled(), { timeout: 3000 })
      fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
      await vi.waitFor(() => expect(tarjetas()).toHaveLength(48))
    })

    it('al cambiar filtro, orden o búsqueda vuelve al inicio del listado y no al montar', async () => {
      const scroll = vi.fn()
      Element.prototype.scrollIntoView = scroll
      try {
        mocks.leer.mockResolvedValue(tanda(1, 24, 24, 1))
        montar('/catalogo')
        await screen.findAllByTestId('tarjeta-producto')
        expect(scroll).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'Solo con stock' }))
        await vi.waitFor(() => expect(scroll).toHaveBeenCalledTimes(1))
        expect(scroll).toHaveBeenCalledWith({ block: 'start' })
      } finally {
        // jsdom no define scrollIntoView: se quita el mock para no filtrarlo a otros tests.
        delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
      }
    })
  })

  it('sin violaciones de axe con «Cargar más», con error de tanda y con fin de lista', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.leer.mockImplementation((_h: string, _f: unknown, n: number) =>
      n === 1 ? Promise.resolve(tanda(1, 24, 30, 1)) : Promise.reject(new Error('boom')),
    )
    const { container } = montar('/catalogo')
    await screen.findAllByTestId('tarjeta-producto')
    expect(await violacionesAxe(container)).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
    await screen.findByRole('alert')
    expect(await violacionesAxe(container)).toEqual([])
    mocks.leer.mockImplementation((_h: string, _f: unknown, n: number) => Promise.resolve(tanda(25, 6, 30, n)))
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await screen.findByText('No hay más resultados.')
    expect(await violacionesAxe(container)).toEqual([])
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
    expect(mocks.leer).toHaveBeenLastCalledWith('sanjavucho.localhost', expect.anything(), 1)
  })

  it('avisa si falla y permite reintentar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.leer.mockRejectedValueOnce(new Error('boom'))
    montar('/catalogo')
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos cargar los productos.')
    // FR-004/FR-024: la pantalla de error no se indexa.
    await waitFor(() => expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex'))
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
    await screen.findByText('No hay productos con esos filtros')
    expect(await violacionesAxe(container)).toEqual([])
  })
})

// F-TDA-15 (SC-005, FR-025…FR-027, FR-029): resultados de la búsqueda en `/catalogo?q=`.
describe('ListadoProductos · búsqueda (q)', () => {
  beforeEach(() => {
    mocks.buscar.mockResolvedValue(pagina())
  })

  it('con q lee la búsqueda (no el catálogo) con los filtros de la URL', async () => {
    montar(`/catalogo?q=cargador&categoria=${CAT_A}&stock=1&orden=precio_asc&pagina=2`)
    await screen.findAllByTestId('tarjeta-producto')
    expect(mocks.buscar).toHaveBeenCalledWith(HOST, 'cargador', { categoria: CAT_A, soloConStock: true, precioMax: null, orden: 'precio_asc' }, 1)
    expect(mocks.leer).not.toHaveBeenCalled()
  })

  it('q inválida se normaliza: espacios colapsados y recortada a 100; vacía es el catálogo común', async () => {
    montar(`/catalogo?q=${encodeURIComponent('  carga   dor  ')}`)
    await screen.findAllByTestId('tarjeta-producto')
    expect(mocks.buscar).toHaveBeenCalledWith(HOST, 'carga dor', expect.anything(), 1)
  })

  it('q vacía lee el catálogo común', async () => {
    montar('/catalogo?q=%20%20')
    await screen.findAllByTestId('tarjeta-producto')
    expect(mocks.leer).toHaveBeenCalled()
    expect(mocks.buscar).not.toHaveBeenCalled()
  })

  it('q solo rige en /catalogo: en una categoría se ignora', async () => {
    montar('/categoria/' + CAT_A + '?q=cargador', CAT_A)
    await screen.findAllByTestId('tarjeta-producto')
    expect(mocks.buscar).not.toHaveBeenCalled()
    expect(mocks.leer).toHaveBeenCalled()
  })

  it('cambiar filtro, orden o página conserva q en la URL', async () => {
    montar('/catalogo?q=cargador')
    await screen.findAllByTestId('tarjeta-producto')
    fireEvent.click(screen.getByRole('button', { name: 'Solo con stock' }))
    expect(ubicacion()).toBe('/catalogo?q=cargador&stock=1')
    await screen.findAllByTestId('tarjeta-producto')
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Ordenar por' }))
    fireEvent.click(screen.getByRole('option', { name: 'Mayor precio' }))
    expect(ubicacion()).toBe('/catalogo?q=cargador&stock=1&orden=precio_desc')
    await vi.waitFor(() => expect(mocks.buscar).toHaveBeenLastCalledWith(HOST, 'cargador', expect.objectContaining({ orden: 'precio_desc' }), 1))
  })

  it('elegir una categoría desde el panel conserva q', async () => {
    montar('/catalogo?q=cargador')
    await screen.findAllByTestId('tarjeta-producto')
    fireEvent.click(screen.getByRole('button', { name: /Cargadores/ }))
    expect(ubicacion()).toBe(`/catalogo?q=cargador&categoria=${CAT_B}`)
  })

  it('sin coincidencias: «No hay productos con esos filtros» y «Limpiar filtros» deja solo la búsqueda', async () => {
    mocks.buscar.mockResolvedValue(pagina({ total: 0, productos: [] }))
    montar('/catalogo?q=zzzz&stock=1')
    await screen.findByText('No hay productos con esos filtros')
    fireEvent.click(within(screen.getByTestId('catalogo-vacio')).getByRole('button', { name: 'Limpiar filtros' }))
    expect(ubicacion()).toBe('/catalogo?q=zzzz')
  })

  it('el texto buscado nunca se interpreta como HTML ni rompe la URL', async () => {
    const q = '<script>alert(1)</script> & "x"'
    montar(`/catalogo?q=${encodeURIComponent(q)}`)
    await screen.findAllByTestId('tarjeta-producto')
    expect(mocks.buscar).toHaveBeenCalledWith(HOST, q, expect.anything(), 1)
    fireEvent.click(screen.getByRole('button', { name: 'Solo con stock' }))
    expect(new URLSearchParams(ubicacion()?.split('?')[1]).get('q')).toBe(q)
  })

  it('límite superado: aviso con role="status" y, pasado el tiempo, la búsqueda se repite sola', async () => {
    mocks.buscar.mockReset()
    mocks.buscar
      .mockResolvedValueOnce(pagina({ total: 0, productos: [], esperaSegundos: 1 }))
      .mockResolvedValueOnce(pagina())
    montar('/catalogo?q=cargador')
    const aviso = await screen.findByTestId('busqueda-espera')
    expect(aviso).toHaveAttribute('role', 'status')
    expect(aviso).toHaveTextContent('Esperá 1 segundo')
    expect(screen.queryAllByTestId('tarjeta-producto')).toHaveLength(0)

    // Reloj real: a los 1000 ms el listado vuelve a pedir la búsqueda solo, sin recargar.
    expect(await screen.findAllByTestId('tarjeta-producto', undefined, { timeout: 3000 })).toHaveLength(2)
    expect(screen.queryByTestId('busqueda-espera')).not.toBeInTheDocument()
    expect(mocks.buscar).toHaveBeenCalledTimes(2)
  })

  it('error de la búsqueda: aviso con reintento', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.buscar.mockRejectedValueOnce(new Error('boom'))
    montar('/catalogo?q=cargador')
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos cargar los productos.')
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findAllByTestId('tarjeta-producto')).toHaveLength(2)
  })

  it('sin violaciones de axe con resultados y con el aviso de espera', async () => {
    const { container, unmount } = montar('/catalogo?q=cargador')
    await screen.findAllByTestId('tarjeta-producto')
    expect(await violacionesAxe(container)).toEqual([])
    unmount()
    mocks.buscar.mockResolvedValue(pagina({ total: 0, productos: [], esperaSegundos: 30 }))
    const espera = montar('/catalogo?q=cargador')
    await screen.findByTestId('busqueda-espera')
    expect(await violacionesAxe(espera.container)).toEqual([])
  })
})
