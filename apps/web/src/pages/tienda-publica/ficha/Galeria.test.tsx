import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ImagenFicha } from '../../../lib/tiendaFicha'
import { Galeria } from './Galeria'

const imagenes = [{ ruta: 'a', posicion: 1 }, { ruta: 'b', posicion: 2 }] as unknown as ImagenFicha[]
const urls = { a: 'https://x.example/a.jpg', b: 'https://x.example/b.jpg' }

// MSF-1002: la imagen principal de la ficha es el elemento del LCP: prioridad alta y sin diferir; las miniaturas siguen diferidas.
describe('Galería de la ficha: prioridad de carga', () => {
  it('la imagen principal pide fetchpriority high y no es lazy; las miniaturas sí son lazy', () => {
    const { container } = render(<Galeria imagenes={imagenes} urls={urls} nombre="Funda" />)
    const principal = container.querySelector('img[alt="Funda"]')!
    expect(principal.getAttribute('fetchpriority')).toBe('high')
    expect(principal.hasAttribute('loading')).toBe(false)
    expect(principal.getAttribute('decoding')).toBe('async')
    const miniaturas = [...container.querySelectorAll('[data-testid="miniatura"] img')]
    expect(miniaturas).toHaveLength(2)
    for (const m of miniaturas) {
      expect(m.getAttribute('loading')).toBe('lazy')
      expect(m.hasAttribute('fetchpriority')).toBe(false)
    }
  })
})
