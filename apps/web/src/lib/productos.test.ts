import { describe, expect, it } from 'vitest'
import {
  FORMULARIO_PRODUCTO_VACIO,
  aParametrosCrear,
  hayCambios,
  parsearImporte,
  separarCompatibles,
  validarProducto,
} from './productos'

const valido = { ...FORMULARIO_PRODUCTO_VACIO, nombre: 'Joystick Pro', precio_lista: '49,90' }

describe('validarProducto', () => {
  it('exige nombre y precio de lista', () => {
    const errores = validarProducto(FORMULARIO_PRODUCTO_VACIO, { conCosto: false })
    expect(Object.keys(errores).sort()).toEqual(['nombre', 'precio_lista'])
  })

  it('un nombre solo con espacios es inválido', () => {
    expect(validarProducto({ ...valido, nombre: '   ' }, { conCosto: false }).nombre).toBeDefined()
  })

  it.each(['0', '-5', 'abc', '10,123', '1.000,50'])('rechaza el precio %s', (precio) => {
    expect(validarProducto({ ...valido, precio_lista: precio }, { conCosto: false }).precio_lista).toBeDefined()
  })

  it('acepta coma o punto decimal', () => {
    expect(parsearImporte('49,90')).toBe(49.9)
    expect(parsearImporte('49.9')).toBe(49.9)
  })

  it('valida el costo solo si el usuario puede cargarlo', () => {
    const conCostoMalo = { ...valido, costo: 'xx' }
    expect(validarProducto(conCostoMalo, { conCosto: true }).costo).toBeDefined()
    expect(validarProducto(conCostoMalo, { conCosto: false }).costo).toBeUndefined()
  })
})

describe('aParametrosCrear', () => {
  it('arma los parámetros de la RPC sin stock', () => {
    const parametros = aParametrosCrear(
      { ...valido, nombre: '  Joystick Pro ', compatible_con: 'PS5, Xbox, PS5, ', costo: '1500,50' },
      { conCosto: true },
    )
    expect(parametros).toEqual({
      p_nombre: 'Joystick Pro',
      p_descripcion: null,
      p_sku: null,
      p_compatible_con: ['PS5', 'Xbox'],
      p_moneda: 'USD',
      p_precio_lista: 49.9,
      p_costo: 1500.5,
    })
    expect(Object.keys(parametros).some((clave) => clave.includes('stock'))).toBe(false)
  })

  it('sin permiso de costo, el costo nunca viaja', () => {
    expect(aParametrosCrear({ ...valido, costo: '99' }, { conCosto: false }).p_costo).toBeNull()
  })
})

describe('separarCompatibles / hayCambios', () => {
  it('recorta y elimina vacíos y repetidos', () => {
    expect(separarCompatibles(' a, ,b,a ')).toEqual(['a', 'b'])
  })

  it('detecta datos cargados sin guardar', () => {
    expect(hayCambios(FORMULARIO_PRODUCTO_VACIO, FORMULARIO_PRODUCTO_VACIO)).toBe(false)
    expect(hayCambios({ ...FORMULARIO_PRODUCTO_VACIO, nombre: 'x' }, FORMULARIO_PRODUCTO_VACIO)).toBe(true)
  })
})
