import { describe, expect, it } from 'vitest'
import { mensajeDeErrorRespuesta, ErrorRespuestaRapida, resolverVariables } from './respuestasRapidas'

const consulta = { nombre: 'Ana Pérez', empresa_nombre: 'San Javucho', producto_nombre: 'Funda' as string | null }

describe('resolverVariables (FR-015)', () => {
  it('reemplaza las tres variables, también repetidas', () => {
    expect(resolverVariables('Hola {nombre}, de {tienda}: {producto}. Chau {nombre}', consulta))
      .toBe('Hola Ana Pérez, de San Javucho: Funda. Chau Ana Pérez')
  })

  it('una variable sin valor queda vacía, sin llaves ni espacios dobles', () => {
    expect(resolverVariables('Consulta por {producto} en {tienda}', { ...consulta, producto_nombre: null }))
      .toBe('Consulta por en San Javucho')
    expect(resolverVariables('Hola {nombre}, gracias', { ...consulta, nombre: '  ' })).toBe('Hola, gracias')
    expect(resolverVariables('Sobre {producto}.', { ...consulta, producto_nombre: null })).toBe('Sobre.')
  })

  it('una variable desconocida se deja tal cual y las llaves sueltas no rompen', () => {
    expect(resolverVariables('Hola {apodo} {', consulta)).toBe('Hola {apodo} {')
  })

  it('no vuelve a expandir lo que trae un valor y respeta los saltos de línea', () => {
    expect(resolverVariables('{nombre}\n{tienda}', { ...consulta, nombre: '{tienda}' })).toBe('{tienda}\nSan Javucho')
  })
})

describe('mensajeDeErrorRespuesta', () => {
  it('traduce permiso y validación, y nunca devuelve el texto crudo', () => {
    expect(mensajeDeErrorRespuesta(new ErrorRespuestaRapida('x', '42501'), 'por defecto')).toMatch(/permiso/)
    expect(mensajeDeErrorRespuesta(new ErrorRespuestaRapida('x', '22023'), 'por defecto')).toMatch(/obligatorios/)
    expect(mensajeDeErrorRespuesta(new ErrorRespuestaRapida('detalle técnico', null), 'por defecto')).toBe('por defecto')
  })
})
