import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  aDetalleAnulacion, armarLineasNota, definicionTipoNota, esTopeDeNota, filasDeNota, hayErroresNota, mensajeDeNotaCredito,
  MENSAJE_CONCEPTO_OBLIGATORIO, MENSAJE_ERROR_NOTA, MENSAJE_IMPORTE_NOTA, MENSAJE_SIN_CANTIDADES, textoStockNota, unidadesDevueltas,
  validarNota, type EntradaNota, type LineaAcreditable, type NotaCredito,
} from './notaCredito'

const linea = (id: string, disponible: number, extra: Partial<LineaAcreditable> = {}): LineaAcreditable => ({
  linea_id: id, orden: 1, descripcion: `Producto ${id}`, cantidad: 10, devuelta: 10 - disponible, disponible, precio_unitario: 100, deposito: 'Central', ...extra,
})

const entrada = (extra: Partial<EntradaNota> = {}): EntradaNota => ({ tipo: 'devolucion_productos', cantidades: {}, importe: '', concepto: '', ...extra })

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('validación de la nota de crédito por devolución de productos', () => {
  const lineas = [linea('a', 3), linea('b', 5)]

  it('acepta cantidades dentro de lo que queda por devolver, incluido el tope exacto', () => {
    const errores = validarNota(entrada({ cantidades: { a: '3', b: '1' } }), lineas)
    expect(errores).toEqual({})
    expect(hayErroresNota(errores)).toBe(false)
  })

  it('pide al menos una unidad cuando todo está vacío o en cero', () => {
    expect(validarNota(entrada(), lineas)).toEqual({ cantidades: MENSAJE_SIN_CANTIDADES })
    expect(validarNota(entrada({ cantidades: { a: '0', b: '  ' } }), lineas)).toEqual({ cantidades: MENSAJE_SIN_CANTIDADES })
  })

  it('marca la línea que supera lo disponible y dice cuánto queda', () => {
    const errores = validarNota(entrada({ cantidades: { a: '4', b: '1' } }), lineas)
    expect(errores.cantidadPorLinea).toEqual({ a: 'Quedan 3 por devolver.' })
    expect(errores.cantidades).toBeUndefined()
  })

  it.each(['1,5', '-1', 'abc', '1e2', '123456', '2 3'])('rechaza la cantidad %j por no ser un entero de hasta cinco dígitos', (texto) => {
    const errores = validarNota(entrada({ cantidades: { a: texto } }), lineas)
    expect(errores.cantidadPorLinea?.a).toBe('Ingresá un número entero.')
  })

  it('ignora espacios alrededor de la cantidad', () => {
    expect(validarNota(entrada({ cantidades: { a: ' 2 ' } }), lineas)).toEqual({})
  })

  it('una línea inválida tapa el aviso general de cantidades', () => {
    const errores = validarNota(entrada({ cantidades: { a: 'x' } }), lineas)
    expect(errores.cantidades).toBeUndefined()
    expect(hayErroresNota(errores)).toBe(true)
  })

  it('sin líneas acreditables no hay nada que devolver', () => {
    expect(validarNota(entrada({ cantidades: { a: '1' } }), [])).toEqual({ cantidades: MENSAJE_SIN_CANTIDADES })
  })
})

describe('validación de la nota de crédito por importe o descuento', () => {
  it.each(['devolucion_importe', 'descuento'] as const)('en %s exige importe mayor a cero y concepto', (tipo) => {
    expect(validarNota(entrada({ tipo, importe: '1500,50', concepto: 'Bonificación' }), [])).toEqual({})
    expect(validarNota(entrada({ tipo }), [])).toEqual({ importe: MENSAJE_IMPORTE_NOTA, concepto: MENSAJE_CONCEPTO_OBLIGATORIO })
  })

  it.each(['0', '0,00', '-5', 'abc', '10,555', '1.000,50', '123456789'])('rechaza el importe %j', (importe) => {
    const errores = validarNota(entrada({ tipo: 'descuento', importe, concepto: 'x' }), [])
    expect(errores.importe).toBe(MENSAJE_IMPORTE_NOTA)
  })

  it('acepta el importe máximo y rechaza el que lo supera', () => {
    expect(validarNota(entrada({ tipo: 'descuento', importe: '99999999,99', concepto: 'x' }), []).importe).toBeUndefined()
    expect(validarNota(entrada({ tipo: 'descuento', importe: '100000000', concepto: 'x' }), []).importe).toBe(MENSAJE_IMPORTE_NOTA)
  })

  it('el concepto solo con espacios cuenta como vacío y tiene un tope de 200 caracteres', () => {
    expect(validarNota(entrada({ tipo: 'descuento', importe: '10', concepto: '   ' }), []).concepto).toBe(MENSAJE_CONCEPTO_OBLIGATORIO)
    expect(validarNota(entrada({ tipo: 'descuento', importe: '10', concepto: 'a'.repeat(200) }), []).concepto).toBeUndefined()
    expect(validarNota(entrada({ tipo: 'descuento', importe: '10', concepto: 'a'.repeat(201) }), []).concepto)
      .toBe('El concepto no puede superar los 200 caracteres.')
  })

  it('el tope de caracteres se mide sin los espacios de los extremos', () => {
    expect(validarNota(entrada({ tipo: 'descuento', importe: '10', concepto: `  ${'a'.repeat(200)}  ` }), []).concepto).toBeUndefined()
  })

  it('las cantidades escritas no importan cuando el motivo no es devolver productos', () => {
    const errores = validarNota(entrada({ tipo: 'descuento', importe: '10', concepto: 'x', cantidades: { a: 'zzz' } }), [linea('a', 1)])
    expect(errores).toEqual({})
  })
})

describe('lo que se envía al emitir la nota', () => {
  it('en devolución de productos manda solo las líneas con unidades, en el orden de la factura', () => {
    const lineas = [linea('a', 5), linea('b', 5), linea('c', 5)]
    expect(armarLineasNota(entrada({ cantidades: { c: '2', a: '1', b: '0' } }), lineas)).toEqual([
      { linea_id: 'a', cantidad: 1 },
      { linea_id: 'c', cantidad: 2 },
    ])
  })

  it('una cantidad ilegible se trata como cero y no se envía', () => {
    expect(armarLineasNota(entrada({ cantidades: { a: 'x', b: '2' } }), [linea('a', 5), linea('b', 5)])).toEqual([{ linea_id: 'b', cantidad: 2 }])
  })

  it('en devolución de importe y descuento manda una única línea con el importe sin IVA', () => {
    expect(armarLineasNota(entrada({ tipo: 'devolucion_importe', importe: '13552,5' }), [])).toEqual([{ importe_sin_iva: 13552.5 }])
    expect(armarLineasNota(entrada({ tipo: 'descuento', importe: '99' }), [linea('a', 1)])).toEqual([{ importe_sin_iva: 99 }])
  })
})

describe('traducción de errores de la nota de crédito', () => {
  it('muestra tal cual los mensajes de la RPC con un código y prefijo conocidos', () => {
    expect(mensajeDeNotaCredito({ code: '42501', message: 'Tu rol no puede emitir notas de crédito en esta tienda' }))
      .toBe('Tu rol no puede emitir notas de crédito en esta tienda')
    expect(mensajeDeNotaCredito({ code: '22023', message: 'La factura está anulada: no admite notas' })).toBe('La factura está anulada: no admite notas')
  })

  it('el tope acreditable (P0001 con hint tope) muestra el mensaje de la base', () => {
    const error = { code: 'P0001', hint: 'tope', message: 'No podés acreditar más que el saldo de la factura' }
    expect(esTopeDeNota(error)).toBe(true)
    expect(mensajeDeNotaCredito(error)).toBe('No podés acreditar más que el saldo de la factura')
  })

  it('un P0001 sin el hint de tope no se considera tope ni se expone', () => {
    const error = { code: 'P0001', message: 'No podés acreditar más que el saldo' }
    expect(esTopeDeNota(error)).toBe(false)
    expect(mensajeDeNotaCredito(error)).toBe(MENSAJE_ERROR_NOTA)
  })

  it('no filtra textos técnicos de Postgres aunque vengan con un código conocido', () => {
    expect(mensajeDeNotaCredito({ code: '42501', message: 'permission denied for function emitir_nota_credito' })).toBe(MENSAJE_ERROR_NOTA)
  })

  it('traduce el comprobante inexistente y cualquier otro error al mensaje general', () => {
    expect(mensajeDeNotaCredito({ code: 'P0002', message: 'x' })).toBe('Esa factura no existe o no pertenece a tu organización.')
    expect(mensajeDeNotaCredito(new Error('boom'))).toBe(MENSAJE_ERROR_NOTA)
    expect(mensajeDeNotaCredito(null)).toBe(MENSAJE_ERROR_NOTA)
    expect(mensajeDeNotaCredito(undefined)).toBe(MENSAJE_ERROR_NOTA)
  })

  it('deja el detalle del error en la consola', () => {
    const error = { code: 'XX000', message: 'detalle interno' }
    mensajeDeNotaCredito(error)
    expect(console.error).toHaveBeenCalledWith(MENSAJE_ERROR_NOTA, error)
  })
})

describe('lectura del detalle de anulación que devuelve la base', () => {
  it('sin datos devuelve un detalle vacío que no permite anular ni emitir', () => {
    for (const dato of [null, undefined, 'texto', 5]) {
      expect(aDetalleAnulacion(dato)).toEqual({
        puede_anular: false, puede_emitir_nota_credito: false, anulacion: null, acreditable_sin_iva: 0, lineas_acreditables: [], notas: [],
      })
    }
  })

  it('los permisos solo se activan con el booleano verdadero, no con valores «verdaderos»', () => {
    const detalle = aDetalleAnulacion({ puede_anular: 'true', puede_emitir_nota_credito: 1 })
    expect(detalle.puede_anular).toBe(false)
    expect(detalle.puede_emitir_nota_credito).toBe(false)
    expect(aDetalleAnulacion({ puede_anular: true, puede_emitir_nota_credito: true })).toMatchObject({ puede_anular: true, puede_emitir_nota_credito: true })
  })

  it('convierte a número los importes que PostgREST entrega como texto', () => {
    const detalle = aDetalleAnulacion({
      acreditable_sin_iva: '1234.50',
      lineas_acreditables: [{ linea_id: 'l1', descripcion: 'X', deposito: 'Central', orden: '2', cantidad: '5', devuelta: '1', disponible: '4', precio_unitario: '99.99' }],
      notas: [{
        id: 'n1', numero: '0001', nc_tipo: 'descuento', concepto: null, fecha: '2027-01-02', total_sin_iva: '100.00', total_con_iva: '121.00',
        lineas: [{ descripcion: 'Y', orden: '1', cantidad: '2', precio_unitario: '50', subtotal_sin_iva: '100', iva: '21' }],
      }],
    })
    expect(detalle.acreditable_sin_iva).toBe(1234.5)
    expect(detalle.lineas_acreditables[0]).toMatchObject({ orden: 2, cantidad: 5, devuelta: 1, disponible: 4, precio_unitario: 99.99 })
    expect(detalle.notas[0]).toMatchObject({ total_sin_iva: 100, total_con_iva: 121 })
    expect(detalle.notas[0].lineas[0]).toMatchObject({ orden: 1, cantidad: 2, precio_unitario: 50, subtotal_sin_iva: 100, iva: 21 })
  })

  it('tolera listas ausentes o que no son arreglos y valores nulos', () => {
    const detalle = aDetalleAnulacion({ lineas_acreditables: 'no', notas: [{ id: 'n', lineas: null, total_sin_iva: null, total_con_iva: undefined }], acreditable_sin_iva: null })
    expect(detalle.lineas_acreditables).toEqual([])
    expect(detalle.acreditable_sin_iva).toBe(0)
    expect(detalle.notas[0]).toMatchObject({ lineas: [], total_sin_iva: 0, total_con_iva: 0 })
  })

  it('conserva los datos de la anulación cuando existen', () => {
    const anulacion = { cuando: '2027-01-01', quien: 'Ana', motivo: 'Error de carga' }
    expect(aDetalleAnulacion({ anulacion }).anulacion).toEqual(anulacion)
  })
})

describe('cómo se muestra una nota de crédito', () => {
  const nota = (extra: Partial<NotaCredito> = {}): NotaCredito => ({
    id: 'n1', numero: '0001', nc_tipo: 'devolucion_productos', concepto: null, fecha: '2027-01-02', total_sin_iva: 200, total_con_iva: 242, lineas: [], ...extra,
  })

  it('una nota con líneas las muestra en negativo, con IVA incluido en el importe', () => {
    const filas = filasDeNota(nota({
      lineas: [
        { orden: 1, descripcion: 'Cable', cantidad: 2, precio_unitario: 50, subtotal_sin_iva: 100, iva: 21 },
        { orden: 2, descripcion: 'Fuente', cantidad: 1, precio_unitario: 100, subtotal_sin_iva: 100, iva: 21 },
      ],
    }))
    expect(filas).toEqual([
      { clave: 'n1-1', descripcion: 'Cable', cantidad: -2, precio: 50, importe: -121 },
      { clave: 'n1-2', descripcion: 'Fuente', cantidad: -1, precio: 100, importe: -121 },
    ])
  })

  it('una nota de importe es una sola fila con el motivo y el concepto', () => {
    expect(filasDeNota(nota({ nc_tipo: 'devolucion_importe', concepto: 'Reintegro parcial' }))).toEqual([
      { clave: 'n1-importe', descripcion: 'Devolución de importe · Reintegro parcial', cantidad: -1, precio: 200, importe: -242 },
    ])
  })

  it('sin concepto la fila lleva solo el nombre del motivo', () => {
    expect(filasDeNota(nota({ nc_tipo: 'descuento' }))[0].descripcion).toBe('Descuento o bonificación')
  })

  it('un motivo desconocido se muestra con su valor crudo', () => {
    expect(definicionTipoNota('otro')).toEqual({ valor: 'descuento', etiqueta: 'otro', descripcion: '' })
  })

  it('cuenta unidades solo en devolución de productos', () => {
    const lineas = [
      { orden: 1, descripcion: 'A', cantidad: 2, precio_unitario: 1, subtotal_sin_iva: 2, iva: 0 },
      { orden: 2, descripcion: 'B', cantidad: 3, precio_unitario: 1, subtotal_sin_iva: 3, iva: 0 },
    ]
    expect(unidadesDevueltas(nota({ lineas }))).toBe(5)
    expect(unidadesDevueltas(nota({ nc_tipo: 'descuento', lineas }))).toBe(0)
  })

  it('el aviso de stock respeta singular y plural y aclara cuándo no cambia', () => {
    const una = [{ orden: 1, descripcion: 'A', cantidad: 1, precio_unitario: 1, subtotal_sin_iva: 1, iva: 0 }]
    const dos = [{ orden: 1, descripcion: 'A', cantidad: 2, precio_unitario: 1, subtotal_sin_iva: 2, iva: 0 }]
    expect(textoStockNota(nota({ lineas: una }))).toBe('Vuelve 1 unidad al stock del depósito de origen.')
    expect(textoStockNota(nota({ lineas: dos }))).toBe('Vuelven 2 unidades al stock del depósito de origen.')
    expect(textoStockNota(nota({ nc_tipo: 'devolucion_importe' }))).toBe('No cambia el stock.')
  })
})
