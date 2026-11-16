import { afterEach, describe, expect, it, vi } from 'vitest'
import { enlaceProducto } from './enlaceProducto'

// F-TDA-25 (SC-007, FR-023).
const ID = 'a1000000-0000-4000-8000-000000000001'

afterEach(() => vi.unstubAllGlobals())

function conUbicacion(href: string) {
  vi.stubGlobal('location', new URL(href))
}

describe('enlaceProducto (FR-023)', () => {
  it('usa el dominio de la tienda actual y la ruta /producto/<id>', () => {
    conUbicacion(`https://mundojc.example.com/producto/${ID}`)
    expect(enlaceProducto(ID)).toBe(`https://mundojc.example.com/producto/${ID}`)
    conUbicacion(`https://sanjavucho.example.com/producto/${ID}`)
    expect(enlaceProducto(ID)).toBe(`https://sanjavucho.example.com/producto/${ID}`)
  })

  it('conserva el puerto del Host y descarta parámetros, búsqueda y hash de la página', () => {
    conUbicacion(`http://mundojc.localhost:4300/catalogo?q=joystick&utm_source=x&categoria=3#arriba`)
    const enlace = enlaceProducto(ID)
    expect(enlace).toBe(`http://mundojc.localhost:4300/producto/${ID}`)
    expect(enlace).not.toMatch(/[?#]/)
  })

  it('codifica el id para que no rompa la ruta', () => {
    conUbicacion('https://mundojc.example.com/')
    expect(enlaceProducto('a/b?c')).toBe('https://mundojc.example.com/producto/a%2Fb%3Fc')
  })
})
