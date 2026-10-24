import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { Galeria } from './ficha/Galeria'
import { TarjetaProducto } from './catalogo/TarjetaProducto'

// F-TDA-17 (FR-047): las imágenes de tarjetas y miniaturas cargan de forma diferida; la imagen principal
// de la ficha no (es el contenido principal que mide el LCP).
describe('Imágenes de la tienda · carga diferida (FR-047)', () => {
  it('la imagen de la tarjeta es loading="lazy"', () => {
    const producto = { id: 'p-1', nombre: 'Joystick', precio: 100, disponible: true, imagen: 'a.png', categoriaId: null, destacado: false }
    const { container } = render(<MemoryRouter><TarjetaProducto producto={producto} urlImagen="https://firmada/a.png" /></MemoryRouter>)
    expect(container.querySelector('img')).toHaveAttribute('loading', 'lazy')
  })

  it('las miniaturas de la galería son lazy y la principal no', () => {
    render(
      <Galeria
        nombre="Joystick"
        imagenes={[{ posicion: 1, ruta: 'a.png' }, { posicion: 2, ruta: 'b.png' }]}
        urls={{ 'a.png': 'https://firmada/a.png', 'b.png': 'https://firmada/b.png' }}
      />,
    )
    const principal = screen.getByRole('img', { name: 'Joystick' })
    expect(principal).not.toHaveAttribute('loading')
    for (const miniatura of screen.getAllByTestId('miniatura')) {
      expect(miniatura.querySelector('img')).toHaveAttribute('loading', 'lazy')
    }
  })
})
