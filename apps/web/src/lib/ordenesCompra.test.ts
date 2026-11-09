import { describe, expect, it } from 'vitest'
import {
  formularioOrdenVacio, lineasParaRpc, mensajeDeErrorOrden, validarMotivoAnulacion, validarOrden,
} from './ordenesCompra'

const EMPRESA = '11111111-1111-1111-1111-111111111111'
const PROVEEDOR = '22222222-2222-2222-2222-222222222222'
const PRODUCTO = '33333333-3333-3333-3333-333333333333'
const PRODUCTO_2 = '44444444-4444-4444-4444-444444444444'
const HOY = '2026-11-09'

const valido = () => ({
  ...formularioOrdenVacio(HOY),
  empresa_id: EMPRESA,
  proveedor_id: PROVEEDOR,
  lineas: [{ producto_id: PRODUCTO, cantidad: '10' }],
})

describe('validarOrden', () => {
  it('acepta una orden completa', () => {
    expect(validarOrden(valido(), HOY)).toEqual({})
  })

  it('exige empresa, proveedor y al menos un producto', () => {
    const errores = validarOrden({ ...formularioOrdenVacio(HOY), lineas: [] }, HOY)
    expect(errores.empresa_id).toBeDefined()
    expect(errores.proveedor_id).toBeDefined()
    expect(errores.lineas).toBe('Elegí al menos un producto en alerta de reposición.')
  })

  it('rechaza una fecha futura', () => {
    const errores = validarOrden({ ...valido(), fecha: '2026-11-10' }, HOY)
    expect(errores.fecha).toBe('La fecha no puede ser futura.')
  })

  it('rechaza cantidades que no son enteros positivos', () => {
    const errores = validarOrden({ ...valido(), lineas: [{ producto_id: PRODUCTO, cantidad: '0' }] }, HOY)
    expect(errores.porLinea?.[0].cantidad).toBeDefined()
  })

  it('no deja repetir el mismo producto', () => {
    const errores = validarOrden({
      ...valido(),
      lineas: [{ producto_id: PRODUCTO, cantidad: '1' }, { producto_id: PRODUCTO, cantidad: '2' }],
    }, HOY)
    expect(errores.porLinea?.[1].producto_id).toBe('No repitas el mismo producto.')
  })

  it('acepta dos productos distintos', () => {
    const errores = validarOrden({
      ...valido(),
      lineas: [{ producto_id: PRODUCTO, cantidad: '1' }, { producto_id: PRODUCTO_2, cantidad: '2' }],
    }, HOY)
    expect(errores.porLinea).toBeUndefined()
  })

  it('rechaza observaciones más largas de lo permitido', () => {
    const errores = validarOrden({ ...valido(), observaciones: 'a'.repeat(1001) }, HOY)
    expect(errores.observaciones).toContain('1000')
  })
})

describe('lineasParaRpc', () => {
  it('manda el producto y la cantidad como número', () => {
    expect(lineasParaRpc([{ producto_id: PRODUCTO, cantidad: '10' }])).toEqual([
      { producto_id: PRODUCTO, cantidad: 10 },
    ])
  })
})

describe('validarMotivoAnulacion', () => {
  it('exige un motivo de 3 a 500 caracteres', () => {
    expect(validarMotivoAnulacion('ab')).toContain('al menos 3')
    expect(validarMotivoAnulacion('a'.repeat(501))).toContain('hasta 500')
    expect(validarMotivoAnulacion('Ya no hace falta')).toBeNull()
  })
})

describe('mensajeDeErrorOrden', () => {
  it('traduce el permiso de la base a un mensaje en castellano', () => {
    const mensaje = mensajeDeErrorOrden({ code: '42501', message: 'Tu rol no puede crear órdenes de compra' }, 'por defecto')
    expect(mensaje).toContain('permiso')
  })

  it('traduce el producto que ya no está en alerta', () => {
    const mensaje = mensajeDeErrorOrden({ code: '22023', message: 'Revisá los productos: alguno ya no está en alerta de reposición' }, 'por defecto')
    expect(mensaje).toContain('alerta de reposición')
  })

  it('deja el mensaje por defecto cuando el error no se reconoce', () => {
    expect(mensajeDeErrorOrden({ code: '99999', message: 'algo raro' }, 'por defecto')).toBe('por defecto')
  })
})
