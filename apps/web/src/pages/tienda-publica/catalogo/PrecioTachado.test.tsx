import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { PrecioTachado } from './PrecioTachado'
import { TarjetaProducto } from './TarjetaProducto'
import { mapearPagina } from '../../../lib/tiendaListado'

// F-PRE-11 (FR-018): la tienda muestra el precio vigente y el anterior tachado SOLO si el anterior es mayor.
describe('PrecioTachado', () => {
  it('con promoción: el precio vigente y el anterior tachado (<del>)', () => {
    render(<PrecioTachado precio={2500} precioAnterior={3000} />)
    expect(screen.getByText('$ 2.500')).toBeInTheDocument()
    const anterior = screen.getByTestId('precio-anterior')
    expect(anterior.tagName).toBe('DEL')
    expect(anterior).toHaveTextContent('$ 3.000')
  })

  it('un lector de pantalla oye cuál es el precio actual y cuál el anterior (no solo el tachado visual)', () => {
    render(<PrecioTachado precio={2500} precioAnterior={3000} />)
    expect(screen.getByText('Precio actual', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Precio anterior', { exact: false })).toBeInTheDocument()
    expect(screen.getByTestId('precio-promocional')).toHaveTextContent(/Precio actual\s*\$ 2\.500/)
    expect(screen.getByTestId('precio-promocional')).toHaveTextContent(/Precio anterior\s*\$ 3\.000/)
  })

  it('sin precio anterior no hay tachado ni textos extra (sin cambios visuales)', () => {
    render(<PrecioTachado precio={18455} precioAnterior={null} />)
    expect(screen.getByText('$ 18.455')).toBeInTheDocument()
    expect(screen.queryByTestId('precio-anterior')).toBeNull()
    expect(screen.queryByText(/Precio anterior/)).toBeNull()
  })

  it('un anterior que no es mayor que el vigente no se tacha (igual o menor)', () => {
    const { rerender } = render(<PrecioTachado precio={3000} precioAnterior={3000} />)
    expect(screen.queryByTestId('precio-anterior')).toBeNull()
    rerender(<PrecioTachado precio={3000} precioAnterior={2000} />)
    expect(screen.queryByTestId('precio-anterior')).toBeNull()
    expect(screen.getByText('$ 3.000')).toBeInTheDocument()
  })

  it('sin precio calculable no muestra nada', () => {
    const { container } = render(<PrecioTachado precio={null} precioAnterior={3000} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('catálogo · precio_anterior de la base', () => {
  const fila = (extra: object) => ({
    total: 1, pagina: 1, tamano: 24, categorias: [],
    productos: [{ id: 'p1', nombre: 'Beta', precio: '2500', disponible: true, imagen: null, categoria_id: null, destacado: false, ...extra }],
  })

  it('mapearPagina conserva precio_anterior como número y la tarjeta lo tacha', () => {
    const producto = mapearPagina(fila({ precio_anterior: '3000' })).productos[0]
    expect(producto.precioAnterior).toBe(3000)
    render(<MemoryRouter><TarjetaProducto producto={producto} /></MemoryRouter>)
    expect(screen.getByTestId('precio-anterior')).toHaveTextContent('$ 3.000')
    expect(screen.getByText('$ 2.500')).toBeInTheDocument()
  })

  it('con precio_anterior null o ausente el producto queda igual que hoy (sin la clave)', () => {
    expect(mapearPagina(fila({ precio_anterior: null })).productos[0]).not.toHaveProperty('precioAnterior')
    expect(mapearPagina(fila({})).productos[0]).not.toHaveProperty('precioAnterior')
  })
})
