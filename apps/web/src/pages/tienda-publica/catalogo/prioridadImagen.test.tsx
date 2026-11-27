import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import type { ProductoListado } from '../../../lib/tiendaListado'
import { TarjetaProducto } from './TarjetaProducto'
import { prioridadDeTarjeta, TARJETAS_CON_PRIORIDAD } from './prioridadImagen'

const producto = { id: 'p1', nombre: 'Funda', precio: 10, disponible: true } as unknown as ProductoListado
const imagenDe = (prioridad?: 'alta' | 'normal') => {
  const { container } = render(<MemoryRouter><TarjetaProducto producto={producto} urlImagen="https://x.example/i.jpg" prioridad={prioridad} /></MemoryRouter>)
  return container.querySelector('img')!
}

describe('prioridad de las imágenes de la grilla (MSF-1002)', () => {
  // Frontera n-1 / n / n+1 alrededor de TARJETAS_CON_PRIORIDAD (= 2): la tarjeta 0 es «alta», la 1 «normal», la 2 en adelante diferida.
  it.each([
    [-1, undefined], [0, 'alta'], [1, 'normal'], [TARJETAS_CON_PRIORIDAD - 1, 'normal'], [TARJETAS_CON_PRIORIDAD, undefined],
    [TARJETAS_CON_PRIORIDAD + 1, undefined], [Number.NaN, undefined], [0.5, undefined],
  ])('el índice %s recibe %s', (indice, esperado) => {
    expect(prioridadDeTarjeta(indice)).toBe(esperado)
  })

  it('la tarjeta con prioridad alta carga eager y con fetchpriority high', () => {
    const img = imagenDe('alta')
    expect(img.getAttribute('loading')).toBe('eager')
    expect(img.getAttribute('fetchpriority')).toBe('high')
    expect(img.getAttribute('decoding')).toBe('async')
  })

  it('la de prioridad normal carga eager pero sin fetchpriority', () => {
    const img = imagenDe('normal')
    expect(img.getAttribute('loading')).toBe('eager')
    expect(img.hasAttribute('fetchpriority')).toBe(false)
  })

  it('sin prioridad sigue diferida (lazy)', () => {
    const img = imagenDe(undefined)
    expect(img.getAttribute('loading')).toBe('lazy')
    expect(img.hasAttribute('fetchpriority')).toBe(false)
    expect(screen.queryAllByRole('img').length).toBeGreaterThanOrEqual(0)
  })
})
