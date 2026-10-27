import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../test/axe'

const mocks = vi.hoisted(() => ({ leer: vi.fn(), firmar: vi.fn(), rpc: vi.fn(), precios: vi.fn() }))

vi.mock('../../lib/tiendaFicha', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/tiendaFicha')>()),
  leerFichaProducto: mocks.leer,
}))
vi.mock('../../lib/imagenProducto', () => ({ urlsImagenesProducto: mocks.firmar }))
// El cliente de Supabase shared: la ficha lee el contacto de la tienda para el botón de WhatsApp
// (F-TDA-14). Se intercepta para no salir a la red desde el test.
vi.mock('../../lib/supabase', () => ({
  supabaseClient: { schema: () => ({ rpc: mocks.rpc }) },
}))
vi.mock('../../lib/tiendaPreciosCliente', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/tiendaPreciosCliente')>()),
  leerPreciosCliente: mocks.precios,
}))

import RutaProducto from './rutas/producto'

// F-TDA-13 (SC-008): galería (selección, «Sin imagen»), ampliación (Esc, foco), datos, compatibilidad
// opcional, 404 y texto con HTML/script literal. Vive fuera de `rutas/` porque esa carpeta se carga con
// import.meta.glob.

const tienda = { tiendaId: 't-1', empresaNombre: 'Mundo JC', estado: 'publicada' }
const contexto = { tienda, host: 'mundojc.localhost', categorias: { fase: 'lista', categorias: [], reintentar: () => undefined } }
const ID = 'a1000000-0000-4000-8000-000000000001'

function ficha(sobrescribe: Record<string, unknown> = {}) {
  return {
    id: ID,
    nombre: 'Joystick Pro',
    descripcion: 'Inalámbrico con vibración',
    sku: 'PC-1',
    categoria: { id: 'ca-1', nombre: 'Joysticks' },
    precio: 18455,
    disponible: true,
    compatibilidad: 'PS4, PS5',
    imagenes: [
      { posicion: 1, ruta: 'org/p/primera.png' },
      { posicion: 2, ruta: 'org/p/segunda.png' },
      { posicion: 3, ruta: 'org/p/tercera.png' },
    ],
    ...sobrescribe,
  }
}

const URLS = {
  'org/p/primera.png': 'https://firmada/primera.png',
  'org/p/segunda.png': 'https://firmada/segunda.png',
  'org/p/tercera.png': 'https://firmada/tercera.png',
}

function montar(entrada = `/producto/${ID}`) {
  return render(
    <MemoryRouter initialEntries={[entrada]}>
      <Routes>
        <Route element={<Outlet context={contexto} />}>
          <Route path="/producto" element={<RutaProducto />} />
          <Route path="/producto/:productoId" element={<RutaProducto />} />
          <Route path="/catalogo" element={<p>Pantalla de catálogo</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.leer.mockResolvedValue(ficha())
  mocks.firmar.mockResolvedValue(URLS)
  mocks.rpc.mockResolvedValue({ data: { nombre: 'Mundo JC', whatsapp: '+54 9 11 7365-2596' }, error: null })
  mocks.precios.mockResolvedValue(null)
})

describe('Ficha de producto · contenido (FR-054)', () => {
  it('muestra migas, nombre, categoría, precio, disponibilidad, descripción, bloque de datos y nota', async () => {
    montar()
    expect(await screen.findByRole('heading', { level: 1, name: 'Joystick Pro' })).toBeInTheDocument()
    expect(mocks.leer).toHaveBeenCalledWith('mundojc.localhost', ID)

    const migas = screen.getByRole('navigation', { name: 'Migas de pan' })
    expect(within(migas).getByRole('link', { name: 'Inicio' })).toHaveAttribute('href', '/')
    expect(within(migas).getByRole('link', { name: 'Todos los productos' })).toHaveAttribute('href', '/catalogo')
    expect(within(migas).getByText('Joystick Pro')).toHaveAttribute('aria-current', 'page')

    expect(screen.getByText('$ 18.455')).toBeInTheDocument()
    expect(screen.getByTestId('etiqueta-disponibilidad')).toHaveTextContent('Disponible')
    expect(screen.getByText('Inalámbrico con vibración')).toBeInTheDocument()

    const datos = screen.getByLabelText('Datos del producto')
    expect(within(datos).getByText('SKU').nextSibling).toHaveTextContent('PC-1')
    expect(within(datos).getByText('Categoría').nextSibling).toHaveTextContent('Joysticks')
    expect(within(datos).getByText('Disponibilidad').nextSibling).toHaveTextContent('Disponible')

    expect(screen.getByText('Precios y disponibilidad sujetos a cambios.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver más productos' })).toHaveAttribute('href', '/catalogo')
  })

  it('sin stock: la etiqueta dice «Sin stock»', async () => {
    mocks.leer.mockResolvedValue(ficha({ disponible: false }))
    montar()
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByTestId('etiqueta-disponibilidad')).toHaveTextContent('Sin stock')
  })

  it('sin precio calculable no muestra precio ni inventa uno', async () => {
    mocks.leer.mockResolvedValue(ficha({ precio: null }))
    montar()
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
  })

  it('la descripción con HTML o script se ve literal (no se interpreta)', async () => {
    const malo = '<script>window.hackeado = true</script><b>negrita</b>'
    mocks.leer.mockResolvedValue(ficha({ nombre: '<img src=x onerror=alert(1)>', descripcion: malo }))
    const { container } = montar()
    expect(await screen.findByText(malo)).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('<img src=x onerror=alert(1)>')
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect((window as unknown as { hackeado?: boolean }).hackeado).toBeUndefined()
  })
})

describe('Ficha de producto · compatibilidad opcional (FR-055)', () => {
  it('con datos muestra el rótulo y los valores unidos con coma', async () => {
    montar()
    await screen.findByRole('heading', { level: 1 })
    const bloque = screen.getByTestId('compatibilidad')
    expect(within(bloque).getByRole('heading', { name: 'Compatible con' })).toBeInTheDocument()
    expect(bloque).toHaveTextContent('PS4, PS5')
  })

  it('sin datos el bloque no aparece', async () => {
    mocks.leer.mockResolvedValue(ficha({ compatibilidad: null }))
    montar()
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByTestId('compatibilidad')).not.toBeInTheDocument()
    expect(screen.queryByText('Compatible con')).not.toBeInTheDocument()
  })
})

describe('Ficha de producto · galería (FR-052)', () => {
  it('la principal es la de menor posición y las miniaturas cambian la imagen', async () => {
    montar()
    await screen.findByRole('heading', { level: 1 })
    const principal = screen.getByRole('button', { name: 'Ampliar imagen' }).querySelector('img')
    expect(principal).toHaveAttribute('src', URLS['org/p/primera.png'])

    const miniaturas = screen.getAllByTestId('miniatura')
    expect(miniaturas).toHaveLength(3)
    expect(miniaturas[0]).toHaveAttribute('aria-pressed', 'true')
    expect(miniaturas[1]).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(miniaturas[1])
    expect(screen.getByRole('button', { name: 'Ampliar imagen' }).querySelector('img')).toHaveAttribute('src', URLS['org/p/segunda.png'])
    expect(screen.getAllByTestId('miniatura')[1]).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByTestId('miniatura')[0]).toHaveAttribute('aria-pressed', 'false')
  })

  it('las miniaturas son botones: se alcanzan con el teclado y tienen nombre accesible', async () => {
    montar()
    await screen.findByRole('heading', { level: 1 })
    const segunda = screen.getByRole('button', { name: 'Ver imagen 2 de 3' })
    expect(segunda.tagName).toBe('BUTTON')
    segunda.focus()
    expect(segunda).toHaveFocus()
  })

  it('muestra como máximo 4 miniaturas', async () => {
    const cinco = [1, 2, 3, 4, 5].map((n) => ({ posicion: n, ruta: `org/p/${n}.png` }))
    mocks.leer.mockResolvedValue(ficha({ imagenes: cinco }))
    mocks.firmar.mockResolvedValue(Object.fromEntries(cinco.map((i) => [i.ruta, `https://firmada/${i.posicion}.png`])))
    montar()
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getAllByTestId('miniatura')).toHaveLength(4)
  })

  it('una imagen sin URL firmada no ocupa lugar: entra la quinta válida', async () => {
    const cinco = [1, 2, 3, 4, 5].map((n) => ({ posicion: n, ruta: `org/p/${n}.png` }))
    mocks.leer.mockResolvedValue(ficha({ imagenes: cinco }))
    mocks.firmar.mockResolvedValue(Object.fromEntries(cinco.filter((i) => i.posicion !== 2).map((i) => [i.ruta, `https://firmada/${i.posicion}.png`])))
    montar()
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getAllByTestId('miniatura')).toHaveLength(4)
  })

  it('con una sola imagen no hay miniaturas', async () => {
    mocks.leer.mockResolvedValue(ficha({ imagenes: [{ posicion: 1, ruta: 'org/p/primera.png' }] }))
    montar()
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryAllByTestId('miniatura')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Ampliar imagen' })).toBeInTheDocument()
  })

  it('sin imágenes muestra «Sin imagen»', async () => {
    mocks.leer.mockResolvedValue(ficha({ imagenes: [] }))
    mocks.firmar.mockResolvedValue({})
    montar()
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByTestId('galeria-sin-imagen')).toHaveTextContent('Sin imagen')
    expect(screen.queryByRole('button', { name: 'Ampliar imagen' })).not.toBeInTheDocument()
  })

  it('si la imagen no se pudo firmar cae en «Sin imagen»', async () => {
    mocks.firmar.mockResolvedValue({})
    montar()
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByTestId('galeria-sin-imagen')).toBeInTheDocument()
  })

  it('si la imagen falla al cargar se descarta y la galería sigue con las demás', async () => {
    montar()
    await screen.findByRole('heading', { level: 1 })
    fireEvent.error(screen.getByRole('button', { name: 'Ampliar imagen' }).querySelector('img') as HTMLElement)
    await waitFor(() => expect(screen.getAllByTestId('miniatura')).toHaveLength(2))
    expect(screen.getByRole('button', { name: 'Ampliar imagen' }).querySelector('img')).toHaveAttribute('src', URLS['org/p/segunda.png'])
  })

  it('las imágenes de las miniaturas cargan de forma diferida', async () => {
    montar()
    await screen.findByRole('heading', { level: 1 })
    for (const miniatura of screen.getAllByTestId('miniatura')) {
      expect(miniatura.querySelector('img')).toHaveAttribute('loading', 'lazy')
    }
  })
})

describe('Ficha de producto · ampliación (FR-053)', () => {
  it('abre el diálogo con la imagen y el texto alternativo, y cierra con Esc', async () => {
    montar()
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Ampliar imagen' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Imagen ampliada de Joystick Pro' })
    expect(within(dialogo).getByAltText('Joystick Pro')).toHaveAttribute('src', URLS['org/p/primera.png'])

    fireEvent.keyDown(dialogo, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('cierra con el botón y el foco queda dentro del diálogo mientras está abierto', async () => {
    montar()
    await screen.findByRole('heading', { level: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Ampliar imagen' }))
    const dialogo = await screen.findByRole('dialog')
    const cerrar = within(dialogo).getByRole('button', { name: 'Cerrar imagen ampliada' })
    await waitFor(() => expect(dialogo.contains(document.activeElement)).toBe(true))
    expect(cerrar).toHaveFocus()

    fireEvent.click(cerrar)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('amplía la miniatura elegida, no siempre la primera', async () => {
    montar()
    await screen.findByRole('heading', { level: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Ver imagen 3 de 3' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ampliar imagen' }))
    const dialogo = await screen.findByRole('dialog')
    expect(within(dialogo).getByAltText('Joystick Pro')).toHaveAttribute('src', URLS['org/p/tercera.png'])
  })
})

describe('Ficha de producto · 404 y estados (FR-051, FR-056)', () => {
  it('producto inexistente (la función devuelve null) → 404 amable', async () => {
    mocks.leer.mockResolvedValue(null)
    montar()
    expect(await screen.findByTestId('pagina-no-encontrada')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Joystick Pro' })).not.toBeInTheDocument()
  })

  it('id inválido → 404 sin consultar la base', async () => {
    mocks.leer.mockImplementation(async (_host: string, id: string) => (id === ID ? ficha() : null))
    montar('/producto/no-es-un-uuid')
    expect(await screen.findByTestId('pagina-no-encontrada')).toBeInTheDocument()
  })

  it('/producto sin id → 404', async () => {
    montar('/producto')
    expect(await screen.findByTestId('pagina-no-encontrada')).toBeInTheDocument()
  })

  it('mientras carga muestra el estado de carga del kit', () => {
    mocks.leer.mockReturnValue(new Promise(() => undefined))
    montar()
    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
  })

  it('si falla la lectura muestra el error con «Reintentar», que vuelve a pedir la ficha', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.leer.mockRejectedValueOnce(new Error('sin red'))
    montar()
    expect(await screen.findByText('No pudimos cargar el producto.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Joystick Pro' })).toBeInTheDocument()
    expect(mocks.leer).toHaveBeenCalledTimes(2)
    consola.mockRestore()
  })
})

describe('Ficha de producto · accesibilidad (FR-056)', () => {
  it('la ficha completa no tiene violaciones de axe', async () => {
    const { container } = montar()
    await screen.findByRole('heading', { level: 1 })
    expect(await violacionesAxe(container)).toEqual([])
  })

  it('sin imágenes ni compatibilidad tampoco', async () => {
    mocks.leer.mockResolvedValue(ficha({ imagenes: [], compatibilidad: null, descripcion: null, sku: null, disponible: false }))
    mocks.firmar.mockResolvedValue({})
    const { container } = montar()
    await screen.findByRole('heading', { level: 1 })
    expect(await violacionesAxe(container)).toEqual([])
  })

  it('con el diálogo de ampliación abierto no hay violaciones', async () => {
    montar()
    await screen.findByRole('heading', { level: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Ampliar imagen' }))
    const dialogo = await screen.findByRole('dialog')
    expect(await violacionesAxe(dialogo)).toEqual([])
  })
})
