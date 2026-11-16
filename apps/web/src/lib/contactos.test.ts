import { describe, expect, it } from 'vitest'
import { ErrorContacto, contactoExistenteDe, digitos, esConflicto, mensajeDeError, repartirContacto } from './contactos'

describe('lib/contactos (F-CON-05)', () => {
  it('reparte el contacto de la consulta en correo o teléfono según su formato', () => {
    expect(repartirContacto(' ana@example.com ')).toEqual({ correo: 'ana@example.com', telefono: '' })
    expect(repartirContacto('+54 9 11 5555-1234')).toEqual({ correo: '', telefono: '+54 9 11 5555-1234' })
  })

  it('cuenta solo los dígitos del teléfono', () => {
    expect(digitos('+54 (9) 11-5555')).toBe(9)
  })

  it('identifica el conflicto de edición y el contacto duplicado', () => {
    expect(esConflicto(new ErrorContacto('x', '40001'))).toBe(true)
    expect(esConflicto(new Error('x'))).toBe(false)
    const id = 'e1000000-0000-0000-0000-00000000000b'
    expect(contactoExistenteDe(new ErrorContacto('x', '23505', id))).toBe(id)
    expect(contactoExistenteDe(new ErrorContacto('x', '23505', 'no-es-uuid'))).toBeNull()
    expect(contactoExistenteDe(new ErrorContacto('x', '42501', id))).toBeNull()
  })

  it('traduce los errores a mensajes claros sin mostrar el texto crudo', () => {
    expect(mensajeDeError(new ErrorContacto('crudo', '22023', 'telefono'), 'x')).toMatch(/7 y 15 dígitos/)
    expect(mensajeDeError(new ErrorContacto('crudo', '22023', 'consentimiento'), 'x')).toMatch(/consentimiento/)
    expect(mensajeDeError(new ErrorContacto('crudo', '40001'), 'x')).toMatch(/Otra persona/)
    expect(mensajeDeError(new ErrorContacto('crudo', '42501'), 'x')).toMatch(/permiso/)
    expect(mensajeDeError(new Error('boom'), 'por defecto')).toBe('por defecto')
  })
})
