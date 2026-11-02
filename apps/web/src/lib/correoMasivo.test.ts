import { describe, expect, it } from 'vitest'
import { ASUNTO_MAXIMO, MENSAJE_MAXIMO, redaccionValida, textoErrorCorreoMasivo, validarRedaccion } from './correoMasivo'

describe('correoMasivo · redacción (FR-010)', () => {
  it('asunto y mensaje son obligatorios', () => {
    expect(validarRedaccion('', 'Hola')).toEqual({ asunto: 'El asunto es obligatorio.', mensaje: null })
    expect(validarRedaccion('  ', 'Hola').asunto).toBe('El asunto es obligatorio.')
    expect(validarRedaccion('Asunto', ' \n ').mensaje).toBe('El mensaje es obligatorio.')
  })

  it('respeta los máximos 200 y 10 000 y rechaza saltos de línea en el asunto', () => {
    expect(validarRedaccion('a'.repeat(ASUNTO_MAXIMO), 'b'.repeat(MENSAJE_MAXIMO))).toEqual({ asunto: null, mensaje: null })
    expect(validarRedaccion('a'.repeat(ASUNTO_MAXIMO + 1), 'x').asunto).toMatch(/hasta 200/)
    expect(validarRedaccion('x', 'b'.repeat(MENSAJE_MAXIMO + 1)).mensaje).toMatch(/hasta 10000/)
    expect(validarRedaccion('Asunto\nBcc: otro@example.com', 'x').asunto).toMatch(/saltos de línea/)
  })

  it('el mensaje con etiquetas HTML es texto: es válido y no se interpreta', () => {
    expect(redaccionValida(validarRedaccion('Asunto', '<script>alert(1)</script>'))).toBe(true)
  })
})

describe('correoMasivo · textos de error', () => {
  it('traduce los errores conocidos y nunca muestra el detalle técnico', () => {
    expect(textoErrorCorreoMasivo({ hint: 'sin_destinatarios' })).toMatch(/No hay clientes elegibles/)
    expect(textoErrorCorreoMasivo({ code: '42501' })).toBe('Tu rol no puede enviar el correo masivo.')
    expect(textoErrorCorreoMasivo({ hint: 'limite' })).toMatch(/varias pruebas/)
    expect(textoErrorCorreoMasivo({ code: 'XX000', message: 'detalle interno' })).toBe('No pudimos completar el envío. Probá de nuevo.')
    expect(textoErrorCorreoMasivo(null)).toBe('No pudimos completar el envío. Probá de nuevo.')
  })
})
