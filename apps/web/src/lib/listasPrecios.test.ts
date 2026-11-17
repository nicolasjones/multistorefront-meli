import { describe, expect, it } from 'vitest'
import {
  ejemploAjuste, formatearAjuste, LARGO_DESCRIPCION, LARGO_NOMBRE, MOTIVO_LISTAS_APAGADAS, mensajeErrorLista, parsearAjuste, PRECIO_EJEMPLO, validarLista,
} from './listasPrecios'

describe('ajuste porcentual de una lista de precios', () => {
  it.each([
    ['-20', -20],
    ['+10', 10],
    ['10', 10],
    ['0', 0],
    ['0,25', 0.25],
    ['0.25', 0.25],
    ['-12,5', -12.5],
    ['-90', -90],
    ['100', 100],
    ['100,00', 100],
    ['-90,00', -90],
    ['20 %', 20],
    ['20%', 20],
    ['  -15  ', -15],
    ['20 %  ', 20],
    ['+10 %', 10],
  ])('lee %j como %d', (texto, esperado) => {
    expect(parsearAjuste(texto)).toBe(esperado)
  })

  it.each(['', ' ', '%', 'abc', '--5', '+-5', '5,', ',5', '5,555', '-90,01', '-91', '100,01', '101', '1e2', '1.000', '10,5,5', '5%%', '１０', '1 0', '- 20', '+ 5', '1 000', '5 ,5', '20 % %'])(
    'rechaza %j',
    (texto) => {
      expect(parsearAjuste(texto)).toBeNull()
    },
  )
})

describe('validación de una lista de precios', () => {
  const datos = { nombre: 'Mayorista', descripcion: '', ajusteTexto: '-10' }

  it('una lista correcta no tiene errores', () => {
    expect(validarLista(datos)).toEqual({})
    expect(validarLista({ ...datos, descripcion: 'Para revendedores' })).toEqual({})
  })

  it('el nombre es obligatorio y con tope', () => {
    expect(validarLista({ ...datos, nombre: '   ' }).nombre).toBe('Escribí el nombre de la lista.')
    expect(validarLista({ ...datos, nombre: 'a'.repeat(LARGO_NOMBRE) }).nombre).toBeUndefined()
    expect(validarLista({ ...datos, nombre: 'a'.repeat(LARGO_NOMBRE + 1) }).nombre).toBe(`El nombre no puede superar los ${LARGO_NOMBRE} caracteres.`)
  })

  it('la descripción es opcional y con tope', () => {
    expect(validarLista({ ...datos, descripcion: 'a'.repeat(LARGO_DESCRIPCION) }).descripcion).toBeUndefined()
    expect(validarLista({ ...datos, descripcion: 'a'.repeat(LARGO_DESCRIPCION + 1) }).descripcion).toBe(`La descripción no puede superar los ${LARGO_DESCRIPCION} caracteres.`)
  })

  it('el ajuste fuera de rango o ilegible se rechaza con el rango en el mensaje', () => {
    const mensaje = 'Ingresá un porcentaje entre -90 y +100, con hasta 2 decimales.'
    expect(validarLista({ ...datos, ajusteTexto: '-95' }).ajuste).toBe(mensaje)
    expect(validarLista({ ...datos, ajusteTexto: '' }).ajuste).toBe(mensaje)
    expect(validarLista({ ...datos, ajusteTexto: 'mucho' }).ajuste).toBe(mensaje)
  })

  it('el ajuste cero es válido: la lista no cambia el precio', () => {
    expect(validarLista({ ...datos, ajusteTexto: '0' }).ajuste).toBeUndefined()
  })
})

describe('formato del ajuste', () => {
  it.each([
    [-20, '-20 %'],
    [10, '+10 %'],
    [0, '0 %'],
    [-12.5, '-12,5 %'],
    [0.25, '+0,25 %'],
    [100, '+100 %'],
  ])('muestra %d como %j', (ajuste, texto) => {
    expect(formatearAjuste(ajuste)).toBe(texto)
  })

  it('el texto que muestra se puede volver a leer como el mismo ajuste', () => {
    for (const ajuste of [-90, -12.5, 0, 7.25, 100]) expect(parsearAjuste(formatearAjuste(ajuste))).toBe(ajuste)
  })
})

describe('ejemplo ilustrativo del ajuste', () => {
  it('aplica el porcentaje sobre el precio de ejemplo', () => {
    expect(PRECIO_EJEMPLO).toBe(10000)
    expect(ejemploAjuste(0)).toBe('$ 10.000')
    expect(ejemploAjuste(-20)).toBe('$ 8.000')
    expect(ejemploAjuste(10)).toBe('$ 11.000')
    expect(ejemploAjuste(-12.5)).toBe('$ 8.750')
    expect(ejemploAjuste(0.25)).toBe('$ 10.025')
  })

  it('con el mínimo y el máximo permitidos no da cero ni negativos', () => {
    expect(ejemploAjuste(-90)).toBe('$ 1.000')
    expect(ejemploAjuste(100)).toBe('$ 20.000')
  })
})

describe('mensajes de error de listas de precios', () => {
  it('traduce cada código de la base', () => {
    expect(mensajeErrorLista({ code: '42501' }, 'x')).toBe('Solo un administrador puede cambiar las listas de precios.')
    expect(mensajeErrorLista({ code: '55000' }, 'x')).toBe(MOTIVO_LISTAS_APAGADAS)
    expect(mensajeErrorLista({ code: '23505' }, 'x')).toBe('Ya existe una lista con ese nombre.')
    expect(mensajeErrorLista({ code: '23514' }, 'x')).toContain('entre -90 y +100')
    expect(mensajeErrorLista({ code: '22003' }, 'x')).toContain('entre -90 y +100')
    expect(mensajeErrorLista({ code: '40001' }, 'x')).toContain('Recargá la pantalla')
    expect(mensajeErrorLista({ code: 'P0002' }, 'x')).toBe('La lista o el cliente ya no existe.')
  })

  it('un mensaje corto de la base en 22023 y 23503 se muestra; uno largo o ausente usa el texto por defecto', () => {
    expect(mensajeErrorLista({ code: '22023', message: 'Lista archivada' }, 'por defecto')).toBe('Lista archivada')
    expect(mensajeErrorLista({ code: '23503', message: 'a'.repeat(199) }, 'por defecto')).toBe('a'.repeat(199))
    expect(mensajeErrorLista({ code: '23503', message: 'a'.repeat(200) }, 'por defecto')).toBe('por defecto')
    expect(mensajeErrorLista({ code: '22023' }, 'por defecto')).toBe('por defecto')
    expect(mensajeErrorLista({ code: '22023', message: '' }, 'por defecto')).toBe('por defecto')
  })

  it('un error desconocido, nulo o sin objeto usa el texto por defecto', () => {
    expect(mensajeErrorLista({ code: 'XX000', message: 'detalle' }, 'por defecto')).toBe('por defecto')
    expect(mensajeErrorLista(null, 'por defecto')).toBe('por defecto')
    expect(mensajeErrorLista(undefined, 'por defecto')).toBe('por defecto')
  })
})
