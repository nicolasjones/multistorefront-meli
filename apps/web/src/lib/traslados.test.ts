import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { avisoTrasladoInsuficiente, formularioTrasladoVacio, mensajeDeErrorTraslado, validarTraslado, type FormularioTraslado } from './traslados'

const HOY = '2027-03-15'
const formulario = (extra: Partial<FormularioTraslado> = {}): FormularioTraslado => ({
  origen_id: 'o1', destino_id: 'd1', cantidad: '5', nota: '', fecha: HOY, ...extra,
})

describe('formulario de traslado', () => {
  it('arranca vacío con el origen dado y la fecha de hoy', () => {
    const vacio = formularioTrasladoVacio('o1')
    expect(vacio).toMatchObject({ origen_id: 'o1', destino_id: '', cantidad: '', nota: '' })
    expect(vacio.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(formularioTrasladoVacio().origen_id).toBe('')
  })
})

describe('validación del traslado', () => {
  it('un traslado completo no tiene errores', () => {
    expect(validarTraslado(formulario(), HOY)).toEqual({})
  })

  it('exige origen y destino', () => {
    const errores = validarTraslado(formulario({ origen_id: '', destino_id: '' }), HOY)
    expect(errores.origen_id).toBe('Elegí el depósito de origen.')
    expect(errores.destino_id).toBe('Elegí el depósito de destino.')
  })

  it('el destino no puede ser igual al origen', () => {
    expect(validarTraslado(formulario({ destino_id: 'o1' }), HOY).destino_id).toBe('El destino debe ser distinto del origen.')
  })

  it.each(['', '0', '-2', '1,5', 'abc', '1000000000', ' '])('rechaza la cantidad %j', (cantidad) => {
    expect(validarTraslado(formulario({ cantidad }), HOY).cantidad).toBe('Ingresá una cantidad entera mayor a cero.')
  })

  it('acepta la cantidad mínima de una unidad', () => {
    expect(validarTraslado(formulario({ cantidad: '1' }), HOY).cantidad).toBeUndefined()
  })

  it('la fecha es obligatoria y no puede ser futura; hoy es válido', () => {
    expect(validarTraslado(formulario({ fecha: '' }), HOY).fecha).toBe('Ingresá la fecha del traslado.')
    expect(validarTraslado(formulario({ fecha: '2027-03-16' }), HOY).fecha).toBe('La fecha no puede ser futura.')
    expect(validarTraslado(formulario({ fecha: HOY }), HOY).fecha).toBeUndefined()
    expect(validarTraslado(formulario({ fecha: '2020-02-29' }), HOY).fecha).toBeUndefined()
  })

  it('la fecha de mañana en otro mes o año también es futura', () => {
    expect(validarTraslado(formulario({ fecha: '2027-04-01' }), HOY).fecha).toBe('La fecha no puede ser futura.')
    expect(validarTraslado(formulario({ fecha: '2028-01-01' }), '2027-12-31').fecha).toBe('La fecha no puede ser futura.')
  })

  it('la nota admite hasta 500 caracteres sin contar los espacios de los extremos', () => {
    expect(validarTraslado(formulario({ nota: 'a'.repeat(500) }), HOY).nota).toBeUndefined()
    expect(validarTraslado(formulario({ nota: ` ${'a'.repeat(500)} ` }), HOY).nota).toBeUndefined()
    expect(validarTraslado(formulario({ nota: 'a'.repeat(501) }), HOY).nota).toBe('Máximo 500 caracteres.')
  })
})

describe('aviso de stock insuficiente en el origen', () => {
  it('no avisa mientras la cantidad no pase lo disponible, el tope exacto incluido', () => {
    expect(avisoTrasladoInsuficiente(10, '10')).toBeNull()
    expect(avisoTrasladoInsuficiente(10, '3')).toBeNull()
  })

  it('no avisa con una cantidad ilegible o vacía (eso lo valida el formulario)', () => {
    expect(avisoTrasladoInsuficiente(10, '')).toBeNull()
    expect(avisoTrasladoInsuficiente(10, 'x')).toBeNull()
  })

  it('avisa cuánto hay y cuánto se quiere trasladar, con singular y plural', () => {
    expect(avisoTrasladoInsuficiente(1, '5')).toBe('Hay 1 unidad disponibles en el origen y el traslado es de 5. Reducí la cantidad para continuar.')
    expect(avisoTrasladoInsuficiente(0, '2')).toBe('Hay 0 unidades disponibles en el origen y el traslado es de 2. Reducí la cantidad para continuar.')
  })
})

describe('errores del traslado', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined) })
  afterEach(() => { vi.restoreAllMocks() })

  it('el stock insuficiente explica que el stock cambió mientras se cargaba', () => {
    expect(mensajeDeErrorTraslado({ code: '23514', message: 'No hay stock suficiente en el origen' }, 'x')).toBe(
      'No hay stock suficiente. El stock cambió mientras cargabas el traslado: revisá la cantidad e intentá de nuevo.',
    )
  })

  it('muestra tal cual los rechazos conocidos de la base', () => {
    expect(mensajeDeErrorTraslado({ message: 'El depósito de origen está inactivo: elegí otro' }, 'x')).toBe('El depósito de origen está inactivo: elegí otro')
    expect(mensajeDeErrorTraslado({ message: 'Tu rol no puede trasladar stock' }, 'x')).toBe('Tu rol no puede trasladar stock')
  })

  it('un texto desconocido no se expone: se traduce por código o cae al mensaje por defecto', () => {
    expect(mensajeDeErrorTraslado({ code: '42501', message: 'permission denied' }, 'x')).toContain('No tenés permiso')
    expect(mensajeDeErrorTraslado({ code: '22023', message: 'invalid input' }, 'x')).toContain('Algún dato no es válido')
    expect(mensajeDeErrorTraslado({ message: 'deadlock detected' }, 'No pudimos trasladar')).toBe('No pudimos trasladar')
    expect(mensajeDeErrorTraslado(null, 'No pudimos trasladar')).toBe('No pudimos trasladar')
  })

  it('un 23514 que no es de stock no se confunde con stock insuficiente', () => {
    expect(mensajeDeErrorTraslado({ code: '23514', message: 'violates check constraint' }, 'No pudimos trasladar')).toBe('No pudimos trasladar')
  })
})
