import { describe, expect, it } from 'vitest'
import { armarMensaje, normalizarNumero, urlWhatsapp } from './whatsapp'

// F-TDA-14 (FR-022, FR-023): número, mensaje y URL del enlace de WhatsApp desde la ficha.
describe('normalizarNumero', () => {
  it.each([
    ['+54 9 11 5555-0001', '5491155550001'],
    ['(011) 5555-0001', '01155550001'],
    ['5491155550001', '5491155550001'],
    ['  549 115 555 0001  ', '5491155550001'],
  ])('deja solo los dígitos de %s', (entrada, esperado) => {
    expect(normalizarNumero(entrada)).toBe(esperado)
  })

  it.each([['1234567'], [''], ['   '], ['sin-numero'], [null], [undefined]])(
    '%s no es un número válido',
    (entrada) => {
      expect(normalizarNumero(entrada as string | null | undefined)).toBeNull()
    },
  )
})

describe('armarMensaje', () => {
  it('con precio, con el formato de la ficha', () => {
    expect(armarMensaje('Mundo JC', 'Joystick Pro', 18455.4)).toBe(
      'Hola Mundo JC, quiero consultar por Joystick Pro ($ 18.455). ¿Está disponible?',
    )
  })

  it('sin precio, sin paréntesis', () => {
    expect(armarMensaje('Mundo JC', 'Joystick Pro', null)).toBe(
      'Hola Mundo JC, quiero consultar por Joystick Pro. ¿Está disponible?',
    )
    expect(armarMensaje('Mundo JC', 'Joystick Pro')).toBe(
      'Hola Mundo JC, quiero consultar por Joystick Pro. ¿Está disponible?',
    )
  })

  it('el precio de cero también va entre paréntesis (es un precio, no una ausencia)', () => {
    expect(armarMensaje('Mundo JC', 'Joystick Pro', 0)).toBe(
      'Hola Mundo JC, quiero consultar por Joystick Pro ($ 0). ¿Está disponible?',
    )
  })

  it('los textos viajan como datos: el HTML queda literal, no se interpreta', () => {
    const mensaje = armarMensaje('<b>Empresa</b>', '<script>alert(1)</script>', 1000)
    expect(mensaje).toBe(
      'Hola <b>Empresa</b>, quiero consultar por <script>alert(1)</script> ($ 1.000). ¿Está disponible?',
    )
  })
})

describe('urlWhatsapp', () => {
  it('arma la URL de wa.me con el mensaje codificado', () => {
    expect(urlWhatsapp('+54 9 11 5555-0001', 'Hola, ¿Está disponible?')).toBe(
      'https://wa.me/5491155550001?text=Hola%2C%20%C2%BFEst%C3%A1%20disponible%3F',
    )
  })

  it('el mensaje con espacios y signos no rompe la URL', () => {
    const url = urlWhatsapp('5491155550001', armarMensaje('Mundo JC', 'Joystick Pro', 18455))
    expect(url).toBe('https://wa.me/5491155550001?text=Hola%20Mundo%20JC%2C%20quiero%20consultar%20por%20Joystick%20Pro%20(%24%2018.455).%20%C2%BFEst%C3%A1%20disponible%3F')
  })

  it('sin número válido no hay URL', () => {
    expect(urlWhatsapp('1234567', 'Hola')).toBeNull()
    expect(urlWhatsapp(null, 'Hola')).toBeNull()
    expect(urlWhatsapp(undefined, 'Hola')).toBeNull()
  })

  // El número lo carga la empresa en el panel (dato editable): si trajera un «?» o un «#» la URL
  // dejaría de ser el enlace de WhatsApp. `normalizarNumero` deja solo dígitos, así que el camino es
  // siempre un número y el esquema siempre `https` (nunca `javascript:`).
  it('el número no puede romper la URL: solo dígitos en el camino', () => {
    expect(urlWhatsapp('5491155550001?text=robo', 'Hola')).toBe('https://wa.me/5491155550001?text=Hola')
    expect(urlWhatsapp('5491155550001#ancla', 'Hola')).toBe('https://wa.me/5491155550001?text=Hola')
    expect(urlWhatsapp('javascript:alert(1)', 'Hola')).toBeNull()
  })
})
