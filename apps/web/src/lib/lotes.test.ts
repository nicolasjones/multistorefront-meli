import { describe, expect, it, vi } from 'vitest'
import {
  formatearFechaLote, formularioLoteVacio, hayErroresLote, lineaLoteVacia, lineasParaRpcLote, LARGO_MAXIMO_PROVEEDOR, MAXIMO_CANTIDAD_LINEA, mensajeDeErrorLote,
  validarLote, type FormularioLote,
} from './lotes'

const HOY = '2027-03-15'
const lote = (extra: Partial<FormularioLote> = {}): FormularioLote => ({
  proveedor: 'Distribuidora Sur', fecha: HOY, motivo_id: 'm1', lineas: [{ producto_id: 'p1', cantidad: '10' }], ...extra,
})

describe('formulario de carga en lote', () => {
  it('arranca con una línea vacía, el motivo dado y la fecha indicada', () => {
    expect(formularioLoteVacio('m1', HOY)).toEqual({ proveedor: '', fecha: HOY, motivo_id: 'm1', lineas: [{ producto_id: '', cantidad: '' }] })
    expect(lineaLoteVacia()).toEqual({ producto_id: '', cantidad: '' })
  })

  it('cada línea vacía es un objeto distinto (no se comparte entre filas)', () => {
    expect(lineaLoteVacia()).not.toBe(lineaLoteVacia())
  })
})

describe('validación del lote', () => {
  it('un lote correcto no tiene errores', () => {
    const errores = validarLote(lote(), HOY)
    expect(errores).toEqual({})
    expect(hayErroresLote(errores)).toBe(false)
  })

  it('el proveedor es opcional y tiene tope de largo', () => {
    expect(validarLote(lote({ proveedor: '' }), HOY).proveedor).toBeUndefined()
    expect(validarLote(lote({ proveedor: 'a'.repeat(LARGO_MAXIMO_PROVEEDOR) }), HOY).proveedor).toBeUndefined()
    expect(validarLote(lote({ proveedor: 'a'.repeat(LARGO_MAXIMO_PROVEEDOR + 1) }), HOY).proveedor).toBe(`El proveedor admite hasta ${LARGO_MAXIMO_PROVEEDOR} caracteres.`)
  })

  it('la fecha es obligatoria y no puede ser futura', () => {
    expect(validarLote(lote({ fecha: '' }), HOY).fecha).toBe('Indicá la fecha del lote.')
    expect(validarLote(lote({ fecha: '2027-03-16' }), HOY).fecha).toBe('La fecha no puede ser futura.')
    expect(validarLote(lote({ fecha: HOY }), HOY).fecha).toBeUndefined()
  })

  it('el motivo es obligatorio', () => {
    expect(validarLote(lote({ motivo_id: '' }), HOY).motivo_id).toBe('Elegí un motivo.')
  })

  it('exige al menos una línea', () => {
    expect(validarLote(lote({ lineas: [] }), HOY).lineas).toBe('Agregá al menos un producto.')
  })

  it('cada línea necesita un producto y una cantidad entera mayor a cero', () => {
    const errores = validarLote(lote({ lineas: [{ producto_id: '', cantidad: '' }, { producto_id: 'p2', cantidad: '0' }, { producto_id: 'p3', cantidad: '5' }] }), HOY)
    expect(errores.porLinea).toEqual([
      { producto_id: 'Elegí un producto.', cantidad: 'Ingresá un entero mayor a cero.' },
      { cantidad: 'Ingresá un entero mayor a cero.' },
      {},
    ])
  })

  it('un mismo producto no puede repetirse; la segunda aparición es la marcada', () => {
    const errores = validarLote(lote({ lineas: [{ producto_id: 'p1', cantidad: '1' }, { producto_id: 'p2', cantidad: '1' }, { producto_id: 'p1', cantidad: '2' }] }), HOY)
    expect(errores.porLinea).toEqual([{}, {}, { producto_id: 'Este producto ya está en el lote.' }])
  })

  it('la cantidad máxima por línea se acepta y una unidad más no', () => {
    expect(validarLote(lote({ lineas: [{ producto_id: 'p1', cantidad: String(MAXIMO_CANTIDAD_LINEA) }] }), HOY).porLinea).toBeUndefined()
    expect(validarLote(lote({ lineas: [{ producto_id: 'p1', cantidad: String(MAXIMO_CANTIDAD_LINEA + 1) }] }), HOY).porLinea).toEqual([{ cantidad: 'Ingresá un entero mayor a cero.' }])
  })

  it.each(['-3', '1,5', 'abc', '1e3', ' '])('rechaza la cantidad %j', (cantidad) => {
    expect(validarLote(lote({ lineas: [{ producto_id: 'p1', cantidad }] }), HOY).porLinea).toEqual([{ cantidad: 'Ingresá un entero mayor a cero.' }])
  })

  it('un lote sin líneas no genera detalle por línea', () => {
    expect(validarLote(lote({ lineas: [] }), HOY).porLinea).toBeUndefined()
  })

  it('sin errores en las líneas no se incluye el detalle por línea', () => {
    expect(validarLote(lote(), HOY)).not.toHaveProperty('porLinea')
  })
})

describe('lo que se envía y cómo se muestra', () => {
  it('las líneas viajan con la cantidad numérica', () => {
    expect(lineasParaRpcLote([{ producto_id: 'p1', cantidad: ' 10 ' }, { producto_id: 'p2', cantidad: '3' }])).toEqual([
      { producto: 'p1', cantidad: 10 }, { producto: 'p2', cantidad: 3 },
    ])
  })

  it('la fecha se muestra día/mes/año sin pasar por Date', () => {
    expect(formatearFechaLote('2027-03-05')).toBe('05/03/2027')
    expect(formatearFechaLote('2027-12-31')).toBe('31/12/2027')
  })
})

describe('errores del lote', () => {
  const silencio = () => vi.spyOn(console, 'error').mockImplementation(() => undefined)

  it('el permiso se traduce por código o por el texto del rol', () => {
    const espia = silencio()
    expect(mensajeDeErrorLote({ code: '42501' }, 'x')).toContain('No tenés permiso para registrar lotes')
    expect(mensajeDeErrorLote({ code: 'P0001', message: 'Tu rol no puede registrar lotes' }, 'x')).toContain('No tenés permiso para registrar lotes')
    espia.mockRestore()
  })

  it('un 22023 muestra el mensaje en castellano de la base; sin mensaje cae al texto por defecto', () => {
    const espia = silencio()
    expect(mensajeDeErrorLote({ code: '22023', message: 'El lote admite hasta 100 productos' }, 'x')).toBe('El lote admite hasta 100 productos')
    expect(mensajeDeErrorLote({ code: '22023' }, 'por defecto')).toBe('por defecto')
    expect(mensajeDeErrorLote({ code: '42P01', message: 'relation does not exist' }, 'por defecto')).toBe('por defecto')
    expect(mensajeDeErrorLote(null, 'por defecto')).toBe('por defecto')
    espia.mockRestore()
  })
})
