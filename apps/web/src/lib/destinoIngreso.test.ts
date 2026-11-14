import { describe, expect, it } from 'vitest'
import { destinoInternoSeguro } from './destinoIngreso'

describe('destinoInternoSeguro (MSF-700)', () => {
  it('acepta rutas internas con query', () => {
    expect(destinoInternoSeguro('/clientes?consulta=abc')).toBe('/clientes?consulta=abc')
  })
  it('acepta la ruta de una reparación del QR de la etiqueta (F-SVC-32, FR-050)', () => {
    const ruta = '/service-tecnico/reparaciones/0b6f4c1e-8d2a-4c3b-9a7e-5f2d1c0a9b87'
    expect(destinoInternoSeguro(ruta)).toBe(ruta)
  })
  it.each(['https://sitio-malo.example/service-tecnico/reparaciones/0b6f4c1e-8d2a-4c3b-9a7e-5f2d1c0a9b87', '//sitio-malo.example/service-tecnico/reparaciones/x', '/login?to=https://sitio-malo.example'])(
    'rechaza un destino externo o de ingreso forjado en el QR: %s',
    (valor) => expect(destinoInternoSeguro(valor)).toBeNull(),
  )
  it.each(['', null, undefined, 'clientes', '//evil.com', '/\\evil.com', 'https://evil.com', ['java', 'script:alert(1)'].join(''), '/a\nb', '/login', '/login?to=/x'])(
    'rechaza %s',
    (valor) => expect(destinoInternoSeguro(valor)).toBeNull(),
  )
})
