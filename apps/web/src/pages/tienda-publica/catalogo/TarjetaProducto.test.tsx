import { render, screen, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { crearTemaTienda } from '../../../tema/temaTienda'
import type { ProductoListado } from '../../../lib/tiendaListado'
import { TarjetaProducto } from './TarjetaProducto'

// F-CLI-07 (FR-030, FR-032): las tarjetas del catálogo siguen mostrando el precio x1 público de hoy; el tipo
// de cliente solo cambia la ficha. Visitante, cuenta suspendida, sin cuenta y no habilitada no se distinguen
// de un minorista o mayorista en la tarjeta: la tarjeta no recibe nada del cliente.
const producto: ProductoListado = { id: 'a1000000-0000-4000-8000-000000000001', nombre: 'Joystick Pro', precio: 18455, precioAnterior: null, disponible: true, imagen: null, categoriaId: null, destacado: false }

function montar(p: ProductoListado = producto, urlImagen?: string) {
  return render(<MemoryRouter><TarjetaProducto producto={p} urlImagen={urlImagen} /></MemoryRouter>)
}

// Reglas CSS que emotion inyectó (jsdom no evalúa `@media`: las medidas responsivas se comprueban en el texto de la hoja).
const reglas = () => Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('')

describe('TarjetaProducto · sin regresión de precio', () => {
  it('muestra el precio público x1 y enlaza a la ficha', () => {
    montar()
    expect(screen.getByText('$ 18.455')).toBeInTheDocument()
    expect(screen.getByTestId('tarjeta-producto')).toHaveAttribute('href', `/producto/${producto.id}`)
  })

  it('no depende de la sesión: solo recibe el producto, un precio y sin escalas', () => {
    montar()
    expect(screen.getAllByText(/^\$ /)).toHaveLength(1)
    expect(screen.queryByText(/x5|x10|x50/)).not.toBeInTheDocument()
  })
})

// MSF-847: la tarjeta sigue las medidas del prototipo (MJC_Catalogo / MJC_Home / MJC_Producto).
describe('TarjetaProducto · fidelidad con el prototipo', () => {
  it('el nombre es un h3 dentro del enlace completo y se limita a 2 líneas con alto fijo de 42 px (36 px en celular)', () => {
    montar()
    const tarjeta = screen.getByTestId('tarjeta-producto')
    const nombre = within(tarjeta).getByRole('heading', { level: 3, name: 'Joystick Pro' })
    expect(nombre).toBe(screen.getByTestId('tarjeta-nombre'))
    expect(tarjeta.tagName).toBe('A')
    const css = reglas()
    expect(css).toMatch(/-webkit-line-clamp:2/)
    expect(css).toMatch(/\.css-[\w-]+\{[^}]*height:36px/)
    expect(css).toMatch(/@media \(min-width:900px\)\{\.css-[\w-]+\{[^}]*height:42px/)
    // Nombre largo: el texto completo sigue en el DOM (el recorte es visual, no del contenido).
    montar({ ...producto, id: 'otro', nombre: 'Nombre larguísimo '.repeat(12) })
    expect(screen.getAllByTestId('tarjeta-nombre')[1].textContent).toHaveLength('Nombre larguísimo '.repeat(12).length)
  })

  it('la imagen se ve completa (contain, hasta 86 %) y sin imagen muestra «Sin imagen» sobre el fondo de superficie', () => {
    const { unmount } = montar(producto, 'https://firmada.test/a.png')
    const img = screen.getByTestId('tarjeta-producto').querySelector('img') as HTMLImageElement
    expect(getComputedStyle(img).objectFit).toBe('contain')
    expect(getComputedStyle(img).maxWidth).toBe('86%')
    expect(getComputedStyle(img).maxHeight).toBe('86%')
    unmount()
    montar()
    expect(screen.getByText('Sin imagen')).toBeInTheDocument()
    expect(reglas()).toMatch(/aspect-ratio:\s*171\s*\/\s*159/)
    // Escritorio: el área mide el ancho TOTAL de la tarjeta (282 px de 282), como el prototipo.
    expect(reglas()).toMatch(/padding-bottom:calc\(100% \+ 2px\)/)
  })

  it('«Sin stock»: insignia sobre la imagen (arriba a la izquierda), imagen atenuada y etiqueta gris con punto', () => {
    const { unmount } = montar({ ...producto, disponible: false }, 'https://firmada.test/a.png')
    const insignia = screen.getByTestId('tarjeta-sin-stock')
    expect(insignia).toHaveTextContent('Sin stock')
    const estilo = getComputedStyle(insignia)
    expect(estilo.position).toBe('absolute')
    expect(estilo.left).toBe('10px')
    expect(estilo.top).toBe('10px')
    expect(estilo.borderRadius).toBe('4px')
    expect(getComputedStyle(screen.getByTestId('tarjeta-producto').querySelector('img') as HTMLElement).opacity).toBe('0.45')
    const etiqueta = screen.getByTestId('etiqueta-disponibilidad')
    expect(etiqueta).toHaveTextContent('Sin stock')
    expect(getComputedStyle(etiqueta).color).toBe('rgb(107, 107, 107)')
    unmount()
    // Con stock no hay insignia.
    montar()
    expect(screen.queryByTestId('tarjeta-sin-stock')).not.toBeInTheDocument()
    expect(screen.getByTestId('etiqueta-disponibilidad')).toHaveTextContent('Disponible')
  })

  it('la disponibilidad lleva un punto decorativo de 8 px del mismo color y no muestra cantidades («Últimas unidades» no existe)', () => {
    montar()
    const etiqueta = screen.getByTestId('etiqueta-disponibilidad')
    const punto = etiqueta.querySelector('span[aria-hidden="true"]') as HTMLElement
    expect(punto).not.toBeNull()
    expect(getComputedStyle(punto).width).toBe('8px')
    expect(getComputedStyle(punto).height).toBe('8px')
    expect(getComputedStyle(punto).borderRadius).toBe('50%')
    expect(getComputedStyle(etiqueta).color).toBe('rgb(46, 125, 50)')
    expect(screen.queryByText(/Últimas unidades|unidades/i)).not.toBeInTheDocument()
  })

  it('el precio va en la tipografía de títulos, en negrita y en el color primario de la tienda', () => {
    const tema = crearTemaTienda({ colorPrimario: '#A3111D', tipografiaTitulos: 'Barlow Condensed', tipografiaTexto: 'Barlow' })
    render(<ThemeProvider theme={tema}><MemoryRouter><TarjetaProducto producto={producto} /></MemoryRouter></ThemeProvider>)
    const precio = screen.getByText('$ 18.455')
    const estilo = getComputedStyle(precio)
    expect(estilo.color).toBe('rgb(163, 17, 29)')
    expect(estilo.fontWeight).toBe('700')
    expect(estilo.fontFamily).toContain('Barlow Condensed')
    // Tarjeta: borde de 1 px, radio 8 y recorte del contenido.
    const tarjeta = getComputedStyle(screen.getByTestId('tarjeta-producto'))
    expect(tarjeta.borderRadius).toBe('8px')
    expect(tarjeta.overflow).toBe('hidden')
    expect(tarjeta.borderTopWidth).toBe('1px')
  })
})
