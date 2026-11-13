import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { violacionesAxe } from '../../../test/axe'
import { celular } from '../../../test/matchMedia'
import { GrillaProductos } from './GrillaProductos'
import { TarjetaProducto } from './TarjetaProducto'

const base = { precioAnterior: null, imagen: null, categoriaId: null, destacado: false }
const productos = [
  { ...base, id: 'p-1', nombre: 'Joystick Pro', precio: 18455, disponible: true },
  { ...base, id: 'p-2', nombre: 'Cargador', precio: 5000, disponible: false },
  { ...base, id: 'p-3', nombre: 'Cable', precio: null, disponible: true },
]
const reglas = () => Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('')

function montar(columnas: 3 | 4) {
  return render(
    <MemoryRouter>
      <main>
        <h1>Tienda</h1>
        <h2>Productos</h2>
        <GrillaProductos columnas={columnas}>
          {productos.map((p) => <li key={p.id}><TarjetaProducto producto={p} /></li>)}
        </GrillaProductos>
      </main>
    </MemoryRouter>,
  )
}

// MSF-847: grilla fluida equivalente a las medidas del prototipo (4 columnas de 282 px con 24 px de separación en la portada y los
// relacionados; 3 columnas en el catálogo; 2 columnas de 173 px con 12 px de separación en celular).
describe('GrillaProductos', () => {
  it('es una lista con una tarjeta por ítem y 2 columnas en celular', () => {
    const { container } = montar(4)
    expect(container.querySelector('ul')).not.toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(reglas()).toContain('repeat(2, minmax(0, 1fr))')
    expect(reglas()).toMatch(/gap:12px/)
  })

  it('portada y relacionados: 4 columnas desde `sm` y 24 px de separación desde `md`', () => {
    montar(4)
    expect(reglas()).toMatch(/@media \(min-width:600px\)\{[^}]*repeat\(4, minmax\(0, 1fr\)\)/)
    expect(reglas()).toMatch(/@media \(min-width:900px\)\{[^}]*gap:24px/)
  })

  it('catálogo y categoría: 3 columnas desde `sm`', () => {
    montar(3)
    expect(reglas()).toMatch(/@media \(min-width:600px\)\{[^}]*repeat\(3, minmax\(0, 1fr\)\)/)
  })

  // jsdom no evalúa `@media`: esto comprueba la estructura (lista, tarjetas con h3, sin violaciones de axe) en el modo celular y en el
  // de escritorio forzados con matchMedia; las medidas por ancho (320/768/1440) se miden en Chromium (ver la spec, T008).
  it.each([['celular', true], ['escritorio', false]])('sin violaciones de axe en modo %s (con un sin stock, un sin imagen y un sin precio)', async (_modo, esCelular) => {
    celular(esCelular)
    const { container } = montar(esCelular ? 3 : 4)
    expect(await violacionesAxe(container)).toEqual([])
    Reflect.deleteProperty(window, 'matchMedia')
  })
})
