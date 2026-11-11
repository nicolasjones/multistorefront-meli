import { describe, expect, it } from 'vitest'
import { destinoInternoSeguro } from './destinoIngreso'

describe('destinoInternoSeguro (MSF-700)', () => {
  it('acepta rutas internas con query', () => {
    expect(destinoInternoSeguro('/clientes?consulta=abc')).toBe('/clientes?consulta=abc')
  })
  it.each(['', null, undefined, 'clientes', '//evil.com', '/\\evil.com', 'https://evil.com', ['java', 'script:alert(1)'].join(''), '/a\nb', '/login', '/login?to=/x'])(
    'rechaza %s',
    (valor) => expect(destinoInternoSeguro(valor)).toBeNull(),
  )
})
