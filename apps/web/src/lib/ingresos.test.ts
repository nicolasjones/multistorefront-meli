import { describe, expect, it } from 'vitest'
import {
  formularioIngresoVacio, generarClaveIdempotencia, lineasParaRpc, mensajeDeErrorIngreso, validarIngreso,
} from './ingresos'

const EMPRESA = '11111111-1111-1111-1111-111111111111'
const PROVEEDOR = '22222222-2222-2222-2222-222222222222'
const PRODUCTO = '33333333-3333-3333-3333-333333333333'
const PRODUCTO_2 = '44444444-4444-4444-4444-444444444444'
const HOY = '2026-10-21'

const valido = () => ({
  ...formularioIngresoVacio(HOY),
  empresa_id: EMPRESA,
  proveedor_id: PROVEEDOR,
  lineas: [{ producto_id: PRODUCTO, cantidad: '2', costo_unitario_usd: '10.50' }],
})

describe('validarIngreso', () => {
  it('acepta un ingreso completo', () => {
    expect(validarIngreso(valido(), HOY)).toEqual({})
  })

  it('exige empresa, proveedor y al menos una línea', () => {
    const errores = validarIngreso({ ...formularioIngresoVacio(HOY), lineas: [] }, HOY)
    expect(errores.empresa_id).toBeDefined()
    expect(errores.proveedor_id).toBeDefined()
    expect(errores.lineas).toBeDefined()
  })

  it('rechaza una fecha futura', () => {
    const errores = validarIngreso({ ...valido(), fecha: '2026-10-22' }, HOY)
    expect(errores.fecha).toBe('La fecha no puede ser futura.')
  })

  it('rechaza cantidades inválidas y costos con más de dos decimales', () => {
    const errores = validarIngreso({
      ...valido(),
      lineas: [
        { producto_id: PRODUCTO, cantidad: '0', costo_unitario_usd: '10.555' },
      ],
    }, HOY)
    expect(errores.porLinea?.[0].cantidad).toBeDefined()
    expect(errores.porLinea?.[0].costo_unitario_usd).toBeDefined()
  })

  it('rechaza el mismo producto repetido', () => {
    const errores = validarIngreso({
      ...valido(),
      lineas: [
        { producto_id: PRODUCTO, cantidad: '1', costo_unitario_usd: '10' },
        { producto_id: PRODUCTO, cantidad: '2', costo_unitario_usd: '20' },
        { producto_id: PRODUCTO_2, cantidad: '1', costo_unitario_usd: '5' },
      ],
    }, HOY)
    expect(errores.porLinea?.[1].producto_id).toMatch(/No repitas/)
    expect(errores.porLinea?.[2]).toBeUndefined()
  })

  it('limita el comprobante a 100 caracteres', () => {
    const errores = validarIngreso({ ...valido(), comprobante: 'x'.repeat(101) }, HOY)
    expect(errores.comprobante).toBeDefined()
  })
})

describe('lineasParaRpc', () => {
  it('convierte cantidad y costo a números', () => {
    expect(lineasParaRpc([{ producto_id: PRODUCTO, cantidad: ' 3 ', costo_unitario_usd: '12.40' }])).toEqual([
      { producto_id: PRODUCTO, cantidad: 3, costo_unitario_usd: 12.4 },
    ])
  })
})

describe('generarClaveIdempotencia', () => {
  it('devuelve un uuid válido', () => {
    expect(generarClaveIdempotencia()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })
})

describe('mensajeDeErrorIngreso', () => {
  it('explica el permiso de costo con un mensaje propio', () => {
    const mensaje = mensajeDeErrorIngreso({ code: '42501', message: 'Tu rol no puede actualizar el costo de los productos' }, 'fallback')
    expect(mensaje).toBe('Tu rol no puede actualizar el costo de los productos. Destildá la opción e intentá de nuevo.')
  })

  it('traduce un duplicado de idempotencia', () => {
    expect(mensajeDeErrorIngreso({ code: '23505' }, 'fallback')).toMatch(/ya fue registrado/i)
  })

  it('usa el fallback para un error desconocido', () => {
    expect(mensajeDeErrorIngreso({ code: 'XX000', message: 'boom' }, 'No pudimos registrar el ingreso.')).toBe('No pudimos registrar el ingreso.')
  })
})
