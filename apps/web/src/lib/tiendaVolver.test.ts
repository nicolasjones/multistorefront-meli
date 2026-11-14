import { describe, expect, it } from 'vitest'
import { enlaceIngresarConVolver, rutaVolverSegura } from './tiendaVolver'

// F-CLI-20 (FR-002): `?volver=` solo acepta rutas internas de la tienda (nada de open redirect).
describe('rutaVolverSegura', () => {
  it.each([
    '/mi-cuenta',
    '/mi-cuenta?seccion=favoritos',
    '/producto/a1000000-0000-4000-8000-000000000001',
    '/mi-cuenta?seccion=compras&compra=a1000000-0000-4000-8000-000000000001',
  ])('acepta la ruta interna %s', (ruta) => {
    expect(rutaVolverSegura(ruta)).toBe(ruta)
  })

  it.each([
    ['sitio externo con esquema', 'https://evil.example/robo'],
    ['sin barra inicial', 'evil.example'],
    ['mismo protocolo (//)', '//evil.example'],
    ['barra invertida', '/\\evil.example'],
    ['barra con barra invertida adentro', '/ok\\evil'],
    ['javascript:', 'javascript:alert(1)'],
    ['dos puntos adentro', '/ruta:rara'],
    ['salto de línea', '/mi-cuenta\n//evil.example'],
    ['tabulación', '/\t/evil.example'],
    ['espacio', '/mi cuenta'],
    ['vacío', ''],
    ['solo ingresar (bucle)', '/ingresar'],
    ['ingresar con consulta', '/ingresar?volver=/mi-cuenta'],
    ['demasiado largo', `/${'a'.repeat(600)}`],
  ])('rechaza %s', (_motivo, ruta) => {
    expect(rutaVolverSegura(ruta)).toBeNull()
  })

  it('rechaza lo que no es texto', () => {
    expect(rutaVolverSegura(null)).toBeNull()
    expect(rutaVolverSegura(undefined)).toBeNull()
  })
})

describe('enlaceIngresarConVolver', () => {
  it('codifica la ruta y su pestaña', () => {
    expect(enlaceIngresarConVolver('/mi-cuenta?seccion=favoritos')).toBe('/ingresar?volver=%2Fmi-cuenta%3Fseccion%3Dfavoritos')
  })
  it('sin una ruta interna válida queda en /ingresar', () => {
    expect(enlaceIngresarConVolver('https://evil.example')).toBe('/ingresar')
  })
})
