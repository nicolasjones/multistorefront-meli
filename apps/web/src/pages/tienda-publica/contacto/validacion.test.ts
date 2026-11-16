import { describe, expect, it } from 'vitest'
import { MAX_CONTACTO, MAX_MENSAJE, MAX_NOMBRE, validarContacto, type DatosContacto } from './validacion'

const VALIDO: DatosContacto = { nombre: 'Ana', contacto: 'ana@ejemplo.com', mensaje: 'Hola' }

// F-TDA-16 (FR-008): espejo de private.validar_contacto_tienda.
describe('validarContacto', () => {
  it('datos válidos no dan errores', () => {
    expect(validarContacto(VALIDO)).toEqual({})
  })

  it('los tres campos son obligatorios y se recortan', () => {
    expect(Object.keys(validarContacto({ nombre: '  ', contacto: ' ', mensaje: '\n' })).sort()).toEqual(['contacto', 'mensaje', 'nombre'])
  })

  it('respeta los topes de longitud (con trim)', () => {
    expect(validarContacto({ ...VALIDO, nombre: ` ${'n'.repeat(MAX_NOMBRE)} ` })).toEqual({})
    expect(validarContacto({ ...VALIDO, nombre: 'n'.repeat(MAX_NOMBRE + 1) }).nombre).toBeDefined()
    expect(validarContacto({ ...VALIDO, mensaje: 'm'.repeat(MAX_MENSAJE) })).toEqual({})
    expect(validarContacto({ ...VALIDO, mensaje: 'm'.repeat(MAX_MENSAJE + 1) }).mensaje).toBeDefined()
    expect(validarContacto({ ...VALIDO, contacto: `${'a'.repeat(MAX_CONTACTO)}@x.com` }).contacto).toBeDefined()
  })

  it.each(['ana@ejemplo.com', '+54 9 11 5555-1234', '(011) 4444-5555', '12345678', '123456789012345'])('acepta el contacto %s', (contacto) => {
    expect(validarContacto({ ...VALIDO, contacto })).toEqual({})
  })

  it.each(['sin-formato', 'ana@', 'ana@ejemplo', 'a b@ejemplo.com', '1234567', '1234567890123456', '12ab5678'])('rechaza el contacto %s', (contacto) => {
    expect(validarContacto({ ...VALIDO, contacto }).contacto).toBeDefined()
  })

  it('un texto con HTML es válido: se trata como dato', () => {
    expect(validarContacto({ nombre: '<b>Ana</b>', contacto: 'ana@ejemplo.com', mensaje: '<script>alert(1)</script>' })).toEqual({})
  })
})
