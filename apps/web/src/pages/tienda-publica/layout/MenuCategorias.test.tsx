import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CategoriasTienda } from '../../../hooks/useCategoriasTienda'
import { MenuCategorias } from './MenuCategorias'

// MSF-846: la barra muestra solo las categorías que entran en una línea y manda el resto a «Más categorías».

const nombres = ['Joysticks', 'Cargadores', 'Consolas', 'Auriculares', 'Teclados', 'Monitores']
const categorias = (cantidad: number): CategoriasTienda => ({
  fase: 'lista',
  categorias: nombres.slice(0, cantidad).map((nombre, i) => ({ id: `c${i}`, nombre, padreId: null, productos: 10 - i, imagen: null })),
  reintentar: () => undefined,
})

let ancho = 1168
let observadores: Array<() => void> = []

beforeEach(() => {
  observadores = []
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { observadores.push(callback) }
    observe() {}
    disconnect() {}
  })
  // Cada entrada mide 190 px; la lista visible, `ancho`.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const esLista = this.getAttribute('data-testid') === 'menu-categorias-lista'
    return { width: esLista ? ancho : 190, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const montar = (cantidad: number) =>
  render(<MemoryRouter><MenuCategorias categorias={categorias(cantidad)} /></MemoryRouter>)
const enlaces = () => within(screen.getByRole('navigation', { name: 'Categorías' })).getAllByRole('link').map((a) => a.textContent)

describe('MenuCategorias · una sola línea', () => {
  it('con ancho justo muestra solo las que entran y «Más categorías» al final (sin cortar la última)', () => {
    montar(6)
    // 6 × 190 + 6 × 28 de separación > 1168: entran 4 + «Más categorías» (5 × 190 + 4 × 28 = 1062).
    expect(enlaces()).toEqual(['Joysticks', 'Cargadores', 'Consolas', 'Auriculares', 'Más categorías'])
  })

  it('con lugar de sobra muestra las 6 y «Más categorías» solo si el catálogo tiene más', () => {
    ancho = 1600
    montar(6)
    expect(enlaces()).toEqual(nombres)
    ancho = 1168
  })

  it('al cambiar el ancho vuelve a medir', () => {
    const { rerender } = montar(4)
    expect(enlaces()).toEqual(['Joysticks', 'Cargadores', 'Consolas', 'Auriculares'])
    ancho = 700
    observadores.forEach((cb) => cb())
    rerender(<MemoryRouter><MenuCategorias categorias={categorias(4)} /></MemoryRouter>)
    expect(enlaces()).toEqual(['Joysticks', 'Cargadores', 'Más categorías'])
    ancho = 1168
  })

  it('la copia de medida no agrega texto ni enlaces al DOM accesible', () => {
    montar(2)
    expect(screen.getAllByText('Joysticks')).toHaveLength(1)
  })
})
