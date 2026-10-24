import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../test/axe'

const mocks = vi.hoisted(() => ({ categorias: vi.fn() }))

vi.mock('../../lib/tiendaCategorias', () => ({ leerCategoriasPublicas: mocks.categorias }))

import { EnrutadorTienda, rutaDeArchivo } from './EnrutadorTienda'
import { PaginaNoEncontrada } from './PaginaNoEncontrada'

const tienda = { tiendaId: 't-1', empresaNombre: 'Mundo JC', estado: 'publicada' }
const CARGADORES = {
  './rutas/inicio.tsx': async () => ({ default: () => <p>Contenido de la home</p> }),
  './rutas/categoria.tsx': () => import('./rutas/categoria'),
}
const CATEGORIAS = [
  { id: 'c-joysticks', nombre: 'Joysticks', padreId: null, productos: 3 },
  { id: 'c-cargadores', nombre: 'Cargadores', padreId: null, productos: 1 },
]

function montar(url: string, host = 'mundojc.localhost') {
  return render(
    <EnrutadorTienda
      tienda={tienda}
      host={host}
      cargadores={CARGADORES}
      crearRouter={(rutas) => createMemoryRouter(rutas, { initialEntries: [url] })}
    />,
  )
}

describe('rutaDeArchivo (FR-003)', () => {
  it('registra la home, /nombre y /nombre/:nombreId según el archivo', () => {
    expect(rutaDeArchivo('./rutas/inicio.tsx')).toEqual(['/'])
    expect(rutaDeArchivo('./rutas/categoria.tsx')).toEqual(['/categoria', '/categoria/:categoriaId'])
    expect(rutaDeArchivo('./rutas/producto.tsx')).toEqual(['/producto', '/producto/:productoId'])
  })
})

describe('layout, menú y pie (FR-003, FR-004, FR-005, FR-008)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.categorias.mockResolvedValue(CATEGORIAS)
  })

  it('muestra la marca como h1 en la home, el menú con «Inicio» y las categorías, y el pie', async () => {
    montar('/')

    expect(await screen.findByText('Contenido de la home')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Mundo JC' })).toBeInTheDocument()
    const menu = await screen.findByRole('navigation', { name: 'Categorías' })
    await within(menu).findByRole('link', { name: 'Joysticks' })
    expect(within(menu).getAllByRole('link').map((a) => a.textContent)).toEqual(['Inicio', 'Joysticks', 'Cargadores'])
    expect(within(menu).getByRole('link', { name: 'Inicio' })).toHaveAttribute('aria-current', 'page')

    const pie = screen.getByTestId('pie-categorias')
    expect(within(pie).getByRole('heading', { name: 'Categorías' })).toBeInTheDocument()
    expect(within(pie).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Joysticks', '/categoria/c-joysticks'],
      ['Cargadores', '/categoria/c-cargadores'],
    ])
    expect(mocks.categorias).toHaveBeenCalledTimes(1)
    expect(mocks.categorias).toHaveBeenCalledWith('mundojc.localhost')
  })

  it('marca la categoría de la ruta actual', async () => {
    montar('/categoria/c-cargadores')

    const menu = await screen.findByRole('navigation', { name: 'Categorías' })
    const activa = await within(menu).findByRole('link', { name: 'Cargadores' })
    await waitFor(() => expect(activa).toHaveAttribute('aria-current', 'page'))
    expect(within(menu).getByRole('link', { name: 'Joysticks' })).not.toHaveAttribute('aria-current')
    expect(within(menu).getByRole('link', { name: 'Inicio' })).not.toHaveAttribute('aria-current')
  })

  it('las entradas del menú son enlaces nativos, alcanzables con el teclado', async () => {
    montar('/')
    const menu = await screen.findByRole('navigation', { name: 'Categorías' })
    await within(menu).findByRole('link', { name: 'Joysticks' })

    for (const enlace of within(menu).getAllByRole('link')) {
      expect(enlace.tagName).toBe('A')
      expect(enlace).toHaveAttribute('href')
      expect(enlace.tabIndex).toBeGreaterThanOrEqual(0)
      enlace.focus()
      expect(enlace).toHaveFocus()
    }
  })

  it('tienda sin categorías: solo «Inicio», sin error y sin columna en el pie', async () => {
    mocks.categorias.mockResolvedValue([])
    montar('/')

    const menu = await screen.findByRole('navigation', { name: 'Categorías' })
    await waitFor(() => expect(menu).toHaveAttribute('aria-busy', 'false'))
    expect(within(menu).getAllByRole('link').map((a) => a.textContent)).toEqual(['Inicio'])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByTestId('pie-categorias')).not.toBeInTheDocument()
  })

  it('si fallan las categorías, deja «Inicio», avisa y permite reintentar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.categorias.mockRejectedValueOnce(new Error('sin red')).mockResolvedValueOnce(CATEGORIAS)
    montar('/')

    expect(await screen.findByText(/No pudimos cargar las categorías/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await within(screen.getByRole('navigation', { name: 'Categorías' })).findByRole('link', { name: 'Joysticks' })).toBeInTheDocument()
    expect(screen.queryByText(/No pudimos cargar las categorías/)).not.toBeInTheDocument()
  })
})

describe('página de categoría (FR-006, FR-007)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.categorias.mockResolvedValue(CATEGORIAS)
  })

  it('muestra las migas «Inicio / <Categoría>» y el título con el nombre', async () => {
    montar('/categoria/c-joysticks')

    expect(await screen.findByRole('heading', { level: 1, name: 'Joysticks' })).toBeInTheDocument()
    const migas = screen.getByRole('navigation', { name: 'Migas de pan' })
    expect(within(migas).getByRole('link', { name: 'Inicio' })).toHaveAttribute('href', '/')
    expect(within(migas).getByText('Joysticks')).toHaveAttribute('aria-current', 'page')
    // La marca deja de ser h1: el título de la página es el único h1.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it.each([
    ['inexistente', '/categoria/no-existe'],
    ['con un id inválido', '/categoria/%20%3Cscript%3E'],
    ['sin id', '/categoria'],
  ])('una categoría %s muestra la 404 amable', async (_caso, url) => {
    montar(url)

    expect(await screen.findByTestId('pagina-no-encontrada')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/')
  })

  it('una categoría oculta o de otra empresa (que no llega en la lista) da la misma 404', async () => {
    mocks.categorias.mockResolvedValue([CATEGORIAS[1]])
    montar('/categoria/c-joysticks')

    expect(await screen.findByTestId('pagina-no-encontrada')).toBeInTheDocument()
    expect(screen.queryByText('Joysticks')).not.toBeInTheDocument()
  })

  it('una ruta desconocida muestra la 404 amable', async () => {
    montar('/no-existe/nada')
    expect(await screen.findByTestId('pagina-no-encontrada')).toBeInTheDocument()
  })

  it('carga el listado desde secciones-catalogo/*.tsx cuando existe y va vacío si no', async () => {
    const { ordenarSeccionesCatalogo } = await import('./seccionesCatalogo')
    expect(ordenarSeccionesCatalogo({})).toEqual([])
    const orden = ordenarSeccionesCatalogo({
      './secciones-catalogo/b.tsx': { default: () => null, orden: 20 },
      './secciones-catalogo/a.tsx': { default: () => null, orden: 10 },
    })
    expect(orden.map((s) => s.clave)).toEqual(['./secciones-catalogo/a.tsx', './secciones-catalogo/b.tsx'])
  })

  it('si una categoría tarda en cargar, muestra el estado de carga del kit', () => {
    mocks.categorias.mockReturnValue(new Promise(() => {}))
    montar('/categoria/c-joysticks')
    return screen.findByRole('status', { name: 'Cargando contenido' })
  })
})

describe.each([320, 768, 1440])('accesibilidad a %i px (SC-002)', (ancho) => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.categorias.mockResolvedValue(CATEGORIAS)
    window.innerWidth = ancho
  })

  it('la home con menú y pie no tiene violaciones de axe', async () => {
    const { container } = montar('/')
    await screen.findByTestId('pie-categorias')
    expect(await violacionesAxe(container)).toEqual([])
  })

  it('la página de categoría no tiene violaciones de axe', async () => {
    const { container } = montar('/categoria/c-joysticks')
    await screen.findByRole('heading', { level: 1, name: 'Joysticks' })
    expect(await violacionesAxe(container)).toEqual([])
  })

  it('la 404 no tiene violaciones de axe', async () => {
    const { container } = montar('/categoria/no-existe')
    await screen.findByTestId('pagina-no-encontrada')
    expect(await violacionesAxe(container)).toEqual([])
  })
})

describe('PaginaNoEncontrada (FR-007)', () => {
  it('no revela si el recurso existe: el mismo mensaje sin importar el motivo', async () => {
    mocks.categorias.mockResolvedValue(CATEGORIAS)
    const { unmount } = montar('/categoria/no-existe')
    const texto = (await screen.findByTestId('pagina-no-encontrada')).textContent
    unmount()
    montar('/otra/cosa')
    expect((await screen.findByTestId('pagina-no-encontrada')).textContent).toBe(texto)
    expect(PaginaNoEncontrada).toBeTypeOf('function')
  })
})
