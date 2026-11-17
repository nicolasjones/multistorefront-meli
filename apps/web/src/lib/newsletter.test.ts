import { describe, expect, it } from 'vitest'
import { campanaValida, textoDestinatarios, textoErrorNewsletter, textoFecha, validarCampana } from './newsletter'

const ok = { nombre: 'Marzo', asunto: 'Novedades', mensaje: 'Hola' }

describe('validarCampana (espejo de la base)', () => {
  it('acepta datos completos con tienda', () => {
    expect(campanaValida(validarCampana(ok, 'e-1'))).toBe(true)
  })

  it('exige tienda, nombre, asunto y mensaje', () => {
    const errores = validarCampana({ nombre: ' ', asunto: '', mensaje: '' }, null)
    expect(errores).toEqual({ nombre: 'El nombre interno es obligatorio.', asunto: 'El asunto es obligatorio.', mensaje: 'El mensaje es obligatorio.', tienda: 'Elegí la tienda remitente.' })
  })

  it('respeta los límites: nombre 100, asunto 200 sin saltos de línea, mensaje 10 000', () => {
    expect(validarCampana({ ...ok, nombre: 'x'.repeat(100) }, 'e').nombre).toBeNull()
    expect(validarCampana({ ...ok, nombre: 'x'.repeat(101) }, 'e').nombre).toMatch(/hasta 100/)
    expect(validarCampana({ ...ok, asunto: 'x'.repeat(200) }, 'e').asunto).toBeNull()
    expect(validarCampana({ ...ok, asunto: 'x'.repeat(201) }, 'e').asunto).toMatch(/hasta 200/)
    expect(validarCampana({ ...ok, asunto: 'a\nb' }, 'e').asunto).toMatch(/saltos de línea/)
    expect(validarCampana({ ...ok, mensaje: 'x'.repeat(10000) }, 'e').mensaje).toBeNull()
    expect(validarCampana({ ...ok, mensaje: 'x'.repeat(10001) }, 'e').mensaje).toMatch(/hasta 10000/)
  })
})

describe('textos', () => {
  it('traduce los errores de la base sin mostrar el detalle técnico', () => {
    expect(textoErrorNewsletter({ code: '40001', message: 'interno' })).toMatch(/cambió/)
    expect(textoErrorNewsletter({ code: '22023', hint: 'sin_destinatarios' })).toBe('Todavía no hay suscriptores confirmados.')
    expect(textoErrorNewsletter({ code: '42501', message: 'interno' })).not.toMatch(/interno/)
    expect(textoErrorNewsletter({ code: 'XX000', message: 'interno' })).toBe('No pudimos completar la acción. Probá de nuevo.')
    expect(textoErrorNewsletter(null)).toBe('No pudimos completar la acción. Probá de nuevo.')
  })

  it('formatea cantidades y fechas (una fecha inválida no rompe)', () => {
    expect(textoDestinatarios(1)).toBe('1 suscriptor')
    expect(textoDestinatarios(2)).toBe('2 suscriptores')
    expect(textoFecha('no es una fecha')).toBe('')
    expect(textoFecha('2027-03-30T15:05:00Z')).toBe('30/03/2027, 12:05')
  })
})
