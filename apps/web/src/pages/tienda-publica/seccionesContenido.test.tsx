import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../test/axe'
import { CONTENIDO_VACIO } from '../../lib/tiendaContenido'

const mocks = vi.hoisted(() => ({ leer: vi.fn() }))

vi.mock('../../lib/tiendaContenido', async (original) => ({
  ...(await original<typeof import('../../lib/tiendaContenido')>()),
  leerContenidoPublico: mocks.leer,
}))

import BannerHome from './secciones/BannerHome'
import BarraBienvenida from './secciones/BarraBienvenida'
import PieTienda from './secciones/PieTienda'

const tienda = { tiendaId: 't-1', empresaNombre: 'Mundo JC', estado: 'publicada' }
const completo = {
  ...CONTENIDO_VACIO,
  titulo: 'Todo para tu consola',
  subtitulo: 'Cargadores y joysticks',
  texto_boton: 'Ver catálogo',
  bienvenida: 'Accesorios y repuestos',
  pie: 'MundoJC · Accesorios',
}

function Home() {
  return (
    <main>
      <BarraBienvenida tienda={tienda} host="mundojc.localhost" />
      <BannerHome tienda={tienda} host="mundojc.localhost" />
      <PieTienda tienda={tienda} host="mundojc.localhost" />
    </main>
  )
}

describe('secciones de contenido de la tienda pública (FR-034, FR-036, SC-013)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('muestra banner, barra de bienvenida y pie con los textos guardados', async () => {
    mocks.leer.mockResolvedValue(completo)
    render(<Home />)

    expect(await screen.findByRole('heading', { level: 2, name: 'Todo para tu consola' })).toBeInTheDocument()
    expect(screen.getByText('Cargadores y joysticks')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver catálogo' })).toHaveAttribute('href', '#catalogo')
    expect(screen.getByTestId('barra-bienvenida')).toHaveTextContent('Accesorios y repuestos')
    expect(screen.getByTestId('pie-tienda')).toHaveTextContent('MundoJC · Accesorios')
    expect(mocks.leer).toHaveBeenCalledWith('mundojc.localhost')
  })

  it('un texto con HTML o script se muestra literal, nunca interpretado (FR-033, SC-005)', async () => {
    mocks.leer.mockResolvedValue({
      ...completo,
      titulo: '<script>window.__xss = 1</script>',
      subtitulo: '<img src=x onerror="window.__xss = 2">',
      bienvenida: '<b>Hola</b>',
      pie: '<a href="https://malo.example">pie</a>',
    })
    const { container } = render(<Home />)

    expect(await screen.findByText('<script>window.__xss = 1</script>')).toBeInTheDocument()
    expect(screen.getByText('<img src=x onerror="window.__xss = 2">')).toBeInTheDocument()
    expect(screen.getByText('<b>Hola</b>')).toBeInTheDocument()
    expect(screen.getByText('<a href="https://malo.example">pie</a>')).toBeInTheDocument()
    expect(container.querySelector('script, img, b, a[href^="https"]')).toBeNull()
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined()
  })

  it('un texto vacío oculta su elemento (sin marcadores vacíos)', async () => {
    mocks.leer.mockResolvedValue({ ...completo, subtitulo: '   ', texto_boton: '', bienvenida: '', pie: '' })
    render(<Home />)

    expect(await screen.findByRole('heading', { level: 2, name: 'Todo para tu consola' })).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByTestId('barra-bienvenida')).not.toBeInTheDocument()
    expect(screen.queryByTestId('pie-tienda')).not.toBeInTheDocument()
    expect(screen.getByTestId('banner-home').textContent).toBe('Todo para tu consola')
  })

  it('sin ningún texto no se muestra nada', async () => {
    mocks.leer.mockResolvedValue(CONTENIDO_VACIO)
    const { container } = render(<Home />)

    await vi.waitFor(() => expect(mocks.leer).toHaveBeenCalled())
    expect(screen.queryByTestId('banner-home')).not.toBeInTheDocument()
    expect(screen.queryByTestId('barra-bienvenida')).not.toBeInTheDocument()
    expect(screen.queryByTestId('pie-tienda')).not.toBeInTheDocument()
    expect(container.querySelector('main')?.children).toHaveLength(0)
  })

  it('si el contenido no carga, la página sigue sin textos (no se rompe)', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.leer.mockRejectedValue(new Error('red'))
    render(<Home />)

    await vi.waitFor(() => expect(consola).toHaveBeenCalled())
    expect(screen.queryByTestId('banner-home')).not.toBeInTheDocument()
    consola.mockRestore()
  })
})

describe.each([320, 768, 1440])('accesibilidad a %i px', (ancho) => {
  it('la home con textos no tiene violaciones de axe', async () => {
    window.innerWidth = ancho
    mocks.leer.mockResolvedValue(completo)
    const { container } = render(<Home />)
    await screen.findByTestId('banner-home')
    expect(await violacionesAxe(container)).toEqual([])
  })
})
