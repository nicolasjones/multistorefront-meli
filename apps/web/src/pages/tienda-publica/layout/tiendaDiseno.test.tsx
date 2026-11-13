import { configure, render, screen, waitFor, within } from '@testing-library/react'
import { useTheme } from '@mui/material'
import { createMemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../test/axe'
import { celular } from '../../../test/matchMedia'
import { CONTENIDO_VACIO } from '../../../lib/tiendaContenido'
import { IDENTIDAD_BASE } from '../../../lib/tiendaIdentidad'

const mocks = vi.hoisted(() => ({ identidad: vi.fn(), contenido: vi.fn(), contacto: vi.fn(), categorias: vi.fn() }))

vi.mock('../../../lib/tiendaIdentidad', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/tiendaIdentidad')>()),
  resolverIdentidadPublica: mocks.identidad,
  urlPublica: (ruta: string | null) => (ruta ? `https://cdn.test/${ruta}` : null),
}))
vi.mock('../../../lib/tiendaContenido', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../lib/tiendaContenido')>()), leerContenidoPublico: mocks.contenido }))
vi.mock('../../../lib/tiendaContacto', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../lib/tiendaContacto')>()), leerContactoTienda: mocks.contacto }))
vi.mock('../../../lib/tiendaCategorias', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../lib/tiendaCategorias')>()), leerCategoriasPublicas: mocks.categorias }))

import { EnrutadorTienda } from '../EnrutadorTienda'
import BarraBienvenida from '../secciones/BarraBienvenida'
import PieTienda from '../secciones/PieTienda'

// MSF-841 (tramo B): identidad aplicada a toda la tienda, logo, barra superior, encabezado y pie oscuro.
configure({ asyncUtilTimeout: 5000 })

const tienda = { tiendaId: 't-1', empresaNombre: 'Mundo JC', estado: 'publicada' }
const HOST = 'mundojc.localhost'
const IDENTIDAD = { ...IDENTIDAD_BASE, colorPrimario: '#C8102E', colorPrimarioOscuro: '#7A0A12', colorAcento: '#C8102E', colorBarra: '#2A2A2A', tipografiaTitulos: 'Bricolage Grotesque' as const, tipografiaTexto: 'DM Sans' as const, logoRuta: 'org/emp/logo.png' }
const CONTACTO = { nombre: 'Mundo JC', whatsapp: '+54 9 11 7365-2596', correo: 'mundojc377@gmail.com', horarios: null }
const CATEGORIAS = [
  { id: 'c-1', nombre: 'Cargadores', padreId: null, productos: 2, imagen: null },
  { id: 'c-2', nombre: 'Joysticks', padreId: null, productos: 1, imagen: null },
]

function Sonda() {
  const t = useTheme()
  return <p data-testid="sonda">{`${t.palette.primary.main}|${t.typography.h1.fontFamily}|${t.tienda?.barra}`}</p>
}
const CARGADORES = {
  './rutas/inicio.tsx': async () => ({ default: () => <><BarraBienvenida tienda={tienda} host={HOST} /><PieTienda tienda={tienda} host={HOST} /><p>Portada</p></> }),
  './rutas/catalogo.tsx': async () => ({ default: () => <Sonda /> }),
}

function montar(url = '/') {
  return render(<EnrutadorTienda tienda={tienda} host={HOST} cargadores={CARGADORES} crearRouter={(rutas) => createMemoryRouter(rutas, { initialEntries: [url] })} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.identidad.mockResolvedValue(IDENTIDAD)
  mocks.contenido.mockResolvedValue({ ...CONTENIDO_VACIO, eslogan: 'Accesorios y repuestos para tu consola.' })
  mocks.contacto.mockResolvedValue(CONTACTO)
  mocks.categorias.mockResolvedValue(CATEGORIAS)
})

describe('identidad aplicada a toda la tienda (MSF-841)', () => {
  it('el tema de la tienda llega también a /catalogo, no solo a la portada, y la identidad se lee una sola vez', async () => {
    montar('/catalogo')
    await waitFor(() => expect(screen.getByTestId('sonda').textContent).toBe('#C8102E|"Bricolage Grotesque", system-ui, -apple-system, "Segoe UI", sans-serif|#2A2A2A'))
    expect(mocks.identidad).toHaveBeenCalledTimes(1)
    expect(mocks.identidad).toHaveBeenCalledWith(HOST)
    await waitFor(() => expect(document.documentElement.style.getPropertyValue('--tienda-color-barra')).toBe('#2A2A2A'))
  })

  it('la barra superior queda dentro del landmark banner (<header>), en celular y escritorio (axe «region», MSF-846)', async () => {
    for (const esCelular of [true, false]) {
      celular(esCelular)
      const { unmount } = montar('/')
      const barra = await screen.findByTestId('barra-superior')
      expect(within(screen.getByRole('banner')).getByTestId('barra-superior')).toBe(barra)
      expect(barra.closest('header')).not.toBeNull()
      unmount()
    }
    Reflect.deleteProperty(window, 'matchMedia')
  })

  // MSF-847: la capa de 100vw del héroe y sus franjas inclinadas no pueden ensanchar la página.
  it('el layout recorta el desborde horizontal (overflow-x: clip)', async () => {
    montar('/')
    await screen.findByText('Portada')
    expect(getComputedStyle(screen.getByRole('banner').parentElement as HTMLElement).overflowX).toBe('clip')
  })

  // MSF-847: la tabulación sigue el orden visual del encabezado de celular: menú, marca, buscador y, al final, «Ingresar».
  it('en celular el botón de menú va antes que la marca en el DOM (orden de tabulación = orden visual)', async () => {
    celular(true)
    montar('/')
    const menu = await screen.findByRole('button', { name: 'Abrir menú' })
    const marca = within(screen.getByRole('banner')).getByRole('link', { name: 'Mundo JC' })
    expect(menu.compareDocumentPosition(marca) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    Reflect.deleteProperty(window, 'matchMedia')
  })

  it('el contenido y el contacto se leen una sola vez por host aunque los usen la barra, el pie y la portada', async () => {
    montar('/')
    await screen.findByText('Portada')
    await within(await screen.findByTestId('barra-superior')).findByText('mundojc377@gmail.com')
    expect(mocks.contenido).toHaveBeenCalledTimes(1)
    expect(mocks.contacto).toHaveBeenCalledTimes(1)
  })

  it('las categorías se leen una sola vez por host aunque las usen el menú, el pie y el bloque de la portada', async () => {
    const { default: CategoriasInicio } = await import('../secciones/CategoriasInicio')
    const cargadores = { ...CARGADORES, './rutas/inicio.tsx': async () => ({ default: () => <><CategoriasInicio tienda={tienda} host={HOST} /><p>Portada</p></> }) }
    render(<EnrutadorTienda tienda={tienda} host={HOST} cargadores={cargadores} crearRouter={(rutas) => createMemoryRouter(rutas, { initialEntries: ['/'] })} />)
    await screen.findByText('Portada')
    await within(await screen.findByTestId('pie-categorias')).findByRole('link', { name: 'Cargadores' })
    expect(mocks.categorias).toHaveBeenCalledTimes(1)
  })

  it('sin identidad legible la tienda sigue con el tema base y no se rompe', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.identidad.mockRejectedValue(new Error('sin red'))
    montar('/catalogo')
    await waitFor(() => expect(consola).toHaveBeenCalled())
    expect(screen.getByTestId('sonda').textContent).toContain('#222222')
    consola.mockRestore()
  })
})

describe('logo y barra superior (MSF-841)', () => {
  it('el logo va a la izquierda del encabezado, como imagen enlazada a la portada con el nombre de la tienda; es el h1 en la home', async () => {
    montar('/')
    const marca = await screen.findByRole('heading', { level: 1, name: 'Mundo JC' })
    expect(await within(marca).findByRole('img', { name: 'Mundo JC' })).toHaveAttribute('src', 'https://cdn.test/org/emp/logo.png')
    expect(within(marca).getByRole('link')).toHaveAttribute('href', '/')
  })

  it('sin logo, el nombre de la tienda en texto como antes', async () => {
    mocks.identidad.mockResolvedValue({ ...IDENTIDAD, logoRuta: null })
    montar('/')
    const marca = await screen.findByRole('heading', { level: 1, name: 'Mundo JC' })
    expect(within(marca).queryByRole('img')).not.toBeInTheDocument()
  })

  it('la barra muestra el eslogan a la izquierda y WhatsApp y correo a la derecha, con enlaces', async () => {
    montar('/')
    const barra = await screen.findByTestId('barra-superior')
    expect(within(barra).getByText('Accesorios y repuestos para tu consola.')).toBeInTheDocument()
    expect(await within(barra).findByRole('link', { name: '+54 9 11 7365-2596' })).toHaveAttribute('href', 'https://wa.me/5491173652596')
    expect(within(barra).getByRole('link', { name: 'mundojc377@gmail.com' })).toHaveAttribute('href', `mailto:${encodeURIComponent('mundojc377@gmail.com')}`)
  })

  it('el correo del enlace va codificado entero en el mailto (también en el pie)', async () => {
    mocks.contacto.mockResolvedValue({ ...CONTACTO, correo: 'a@b.com?bcc=x@y.com' })
    montar('/')
    const barra = await screen.findByTestId('barra-superior')
    const enlace = await within(barra).findByRole('link', { name: 'a@b.com?bcc=x@y.com' })
    expect(enlace).toHaveAttribute('href', `mailto:${encodeURIComponent('a@b.com?bcc=x@y.com')}`)
    const pieContacto = within(screen.getByTestId('pie-contacto'))
    expect((await pieContacto.findByRole('link', { name: 'a@b.com?bcc=x@y.com' })).getAttribute('href')).toBe(enlace.getAttribute('href'))
  })

  it('reserva la altura de la barra mientras llega el contacto', async () => {
    mocks.contenido.mockResolvedValue(CONTENIDO_VACIO)
    mocks.contacto.mockReturnValue(new Promise(() => undefined))
    montar('/')
    expect(await screen.findByTestId('barra-superior-reserva')).toBeInTheDocument()
  })

  it('sin eslogan muestra la bienvenida en la barra y no la repite en la franja de la portada', async () => {
    mocks.contenido.mockResolvedValue({ ...CONTENIDO_VACIO, bienvenida: 'Hola, bienvenido' })
    montar('/')
    await screen.findByText('Portada')
    await within(await screen.findByTestId('barra-superior')).findByText('Hola, bienvenido')
    expect(screen.getAllByText('Hola, bienvenido')).toHaveLength(1)
    expect(screen.queryByTestId('barra-bienvenida')).not.toBeInTheDocument()
  })

  it('con eslogan y una bienvenida distinta, la bienvenida sigue en su franja de la portada', async () => {
    mocks.contenido.mockResolvedValue({ ...CONTENIDO_VACIO, eslogan: 'Nuestro eslogan', bienvenida: 'Envíos a todo el país' })
    montar('/')
    expect(await screen.findByTestId('barra-bienvenida')).toHaveTextContent('Envíos a todo el país')
    expect(within(screen.getByTestId('barra-superior')).getByText('Nuestro eslogan')).toBeInTheDocument()
  })

  it('un dato ausente no se muestra y sin nada que mostrar no hay barra', async () => {
    mocks.contenido.mockResolvedValue(CONTENIDO_VACIO)
    mocks.contacto.mockResolvedValue({ ...CONTACTO, whatsapp: null, correo: null })
    montar('/')
    await screen.findByText('Portada')
    await waitFor(() => expect(mocks.contacto).toHaveBeenCalled())
    expect(screen.queryByTestId('barra-superior')).not.toBeInTheDocument()
  })

  it('solo con correo, la barra muestra únicamente el correo', async () => {
    mocks.contenido.mockResolvedValue(CONTENIDO_VACIO)
    mocks.contacto.mockResolvedValue({ ...CONTACTO, whatsapp: null })
    montar('/')
    const barra = await screen.findByTestId('barra-superior')
    expect(within(barra).getByRole('link', { name: 'mundojc377@gmail.com' })).toBeInTheDocument()
    expect(within(barra).queryByText(/\+54/)).not.toBeInTheDocument()
  })
})

describe('encabezado y categorías (MSF-841)', () => {
  it('«Inicio» y «Contacto» van en la fila de la marca y la barra de categorías trae solo categorías', async () => {
    montar('/')
    const principal = await screen.findByRole('navigation', { name: 'Principal' })
    expect(within(principal).getAllByRole('link').map((a) => a.textContent)).toEqual(['Inicio', 'Contacto'])
    expect(within(principal).getByRole('link', { name: 'Inicio' })).toHaveAttribute('aria-current', 'page')
    expect(within(principal).getByRole('link', { name: 'Contacto' })).toHaveAttribute('href', '/contacto')
    const categorias = await screen.findByRole('navigation', { name: 'Categorías' })
    await within(categorias).findByRole('link', { name: 'Cargadores' })
    expect(within(categorias).getAllByRole('link').map((a) => a.textContent)).toEqual(['Cargadores', 'Joysticks'])
  })

  it('el buscador tiene el botón de la lupa', async () => {
    montar('/')
    expect(await screen.findByRole('button', { name: 'Buscar' })).toHaveAttribute('type', 'submit')
  })
})

describe('pie oscuro (MSF-841)', () => {
  it('trae logo, eslogan, texto del pie, categorías, contacto y el © con el nombre de la tienda, sin duplicar el texto del pie', async () => {
    mocks.contenido.mockResolvedValue({ ...CONTENIDO_VACIO, eslogan: 'Accesorios y repuestos', pie: 'Envíos a todo el país' })
    montar('/')
    const pie = await screen.findByTestId('pie-tienda-layout')
    expect(await within(pie).findByRole('img', { name: 'Mundo JC' })).toHaveStyle({ filter: 'brightness(0) invert(1)' }) // logo en blanco: pide PNG/SVG con fondo transparente
    expect(await within(pie).findByText('Accesorios y repuestos')).toBeInTheDocument()
    expect(within(pie).getAllByText('Envíos a todo el país')).toHaveLength(1)
    expect(screen.getAllByText('Envíos a todo el país')).toHaveLength(1)
    const categorias = within(pie).getByTestId('pie-categorias')
    expect(await within(categorias).findByRole('link', { name: 'Cargadores' })).toHaveAttribute('href', '/categoria/c-1')
    const contacto = within(pie).getByTestId('pie-contacto')
    expect(await within(contacto).findByRole('link', { name: '+54 9 11 7365-2596' })).toHaveAttribute('href', 'https://wa.me/5491173652596')
    expect(within(contacto).getByRole('link', { name: 'mundojc377@gmail.com' })).toBeInTheDocument()
    expect(within(contacto).getByRole('link', { name: 'Escribinos' })).toHaveAttribute('href', '/contacto')
    expect(within(pie).getByText(`© ${new Date().getFullYear()} Mundo JC. Todos los derechos reservados.`)).toBeInTheDocument()
  })

  it('sin logo muestra el nombre; sin datos de contacto queda solo «Escribinos»', async () => {
    mocks.identidad.mockResolvedValue({ ...IDENTIDAD, logoRuta: null })
    mocks.contacto.mockResolvedValue({ ...CONTACTO, whatsapp: null, correo: null })
    montar('/')
    const pie = await screen.findByTestId('pie-tienda-layout')
    expect(within(pie).queryByRole('img')).not.toBeInTheDocument()
    await waitFor(() => expect(mocks.contacto).toHaveBeenCalled())
    expect(within(within(pie).getByTestId('pie-contacto')).getAllByRole('link').map((a) => a.textContent)).toEqual(['Escribinos'])
  })
})

describe.each([320, 768, 1440])('accesibilidad del layout a %i px', (ancho) => {
  it('no tiene violaciones de axe con identidad, barra y pie', async () => {
    // El modo se fuerza con matchMedia (jsdom no calcula anchos): bajo 900 px rige el layout de celular.
    celular(ancho < 900)
    window.innerWidth = ancho
    const { container } = montar('/')
    await screen.findByText('Portada')
    await screen.findAllByRole('link', { name: 'Cargadores' })
    await within(screen.getByTestId('pie-contacto')).findByRole('link', { name: 'mundojc377@gmail.com' })
    expect(await violacionesAxe(container)).toEqual([])
  })
})
