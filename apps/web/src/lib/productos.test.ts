import { describe, expect, it, vi } from 'vitest'
import {
  FORMULARIO_PRODUCTO_VACIO,
  aFormulario,
  aParametrosActualizar,
  aParametrosCrear,
  hayCambios,
  esCodigoBarrasRepetido,
  mensajeDeError,
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

  it.each(['0', '-5', 'abc', '10,123', '1.000,50', '1234567890123'])('rechaza el precio %s', (precio) => {
    expect(validarProducto({ ...valido, precio_lista: precio }, { conCosto: false }).precio_lista).toBeDefined()
  })

  it('acepta hasta 12 enteros y rechaza 13 (numeric(14,2))', () => {
    expect(parsearImporte('999999999999,99')).toBe(999999999999.99)
    expect(parsearImporte('1000000000000')).toBeNull()
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
      p_proveedor_id: null,
      p_codigo_proveedor: null,
      p_codigo_barras: null,
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

describe('mensajeDeError', () => {
  it('mapea permisos y datos inválidos a castellano y no filtra el texto crudo', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(mensajeDeError({ code: '42501', message: 'policy x' }, 'Base')).toMatch(/permiso/)
    expect(mensajeDeError({ code: '22023', message: 'col y' }, 'Base')).toMatch(/no es válido/)
    expect(mensajeDeError({ code: '22003', message: 'numeric field overflow' }, 'Base')).toMatch(/demasiado grande/)
    expect(mensajeDeError({ code: '23505', message: 'duplicate key productos_org_sku_uidx' }, 'Base')).toBe('Ese SKU ya existe')
    expect(mensajeDeError({ code: '23505', message: 'duplicate key otra_uidx' }, 'Base')).toBe('Base')
    expect(mensajeDeError({ code: '99999', message: 'raw' }, 'Base')).toBe('Base')
  })
})

describe('proveedor del producto (F-PRV-03)', () => {
  it('la edición pide cambiar el proveedor explícitamente', () => {
    const p = aParametrosActualizar(valido, { conCosto: false, id: 'p1', actualizadoEn: 't' })
    expect(p.p_cambiar_proveedor).toBe(true)
  })

  it('«código sin proveedor» no se muestra como proveedor no disponible', () => {
    expect(mensajeDeError({ code: '22023', message: 'El código del proveedor requiere elegir un proveedor' }, 'x'))
      .toMatch(/no es válido/)
  })

  it('sin proveedor viaja nulo y descarta el código', () => {
    const p = aParametrosCrear({ ...valido, codigo_proveedor: 'X-1' }, { conCosto: false })
    expect(p.p_proveedor_id).toBeNull()
    expect(p.p_codigo_proveedor).toBeNull()
  })

  it('con proveedor viaja el id y el código recortado', () => {
    const p = aParametrosCrear({ ...valido, proveedor_id: 'prv-1', codigo_proveedor: '  X-1 ' }, { conCosto: false })
    expect(p.p_proveedor_id).toBe('prv-1')
    expect(p.p_codigo_proveedor).toBe('X-1')
  })

  it('rechaza un código sin proveedor y uno de más de 80 caracteres', () => {
    expect(validarProducto({ ...valido, codigo_proveedor: 'X-1' }, { conCosto: false }).codigo_proveedor)
      .toBe('Elegí un proveedor para cargar su código.')
    expect(validarProducto({ ...valido, proveedor_id: 'prv-1', codigo_proveedor: 'x'.repeat(81) }, { conCosto: false }).codigo_proveedor)
      .toBe('Máximo 80 caracteres.')
    expect(validarProducto({ ...valido, proveedor_id: 'prv-1', codigo_proveedor: 'x'.repeat(80) }, { conCosto: false }))
      .toEqual({})
  })

  it('aFormulario carga el proveedor y el código del producto', () => {
    const f = aFormulario({
      id: 'p', organizacion_id: 'o', nombre: 'N', descripcion: null, sku: null, compatible_con: [], moneda: 'USD',
      precio_lista: 1, activo: true, updated_at: 't', proveedor_id: 'prv-1', codigo_proveedor: 'C', codigo_barras: '7790001000015',
    }, null)
    expect(f.proveedor_id).toBe('prv-1')
    expect(f.codigo_proveedor).toBe('C')
    expect(f.codigo_barras).toBe('7790001000015')
  })

  it('código de barras: vacío es válido y viaja nulo; con 13 dígitos viaja recortado', () => {
    expect(validarProducto({ ...valido, codigo_barras: '' }, { conCosto: false })).toEqual({})
    expect(aParametrosCrear({ ...valido, codigo_barras: ' ' }, { conCosto: false }).p_codigo_barras).toBeNull()
    expect(aParametrosCrear({ ...valido, codigo_barras: ' 7790001000015 ' }, { conCosto: false }).p_codigo_barras).toBe('7790001000015')
  })

  it('código de barras: rechaza lo que no sean 13 dígitos', () => {
    for (const malo of ['123', '77900010000150', '77900010000AB', '779-0001-00015']) {
      expect(validarProducto({ ...valido, codigo_barras: malo }, { conCosto: false }).codigo_barras).toBe('Ingresá 13 dígitos, sin espacios ni guiones.')
    }
  })

  it('actualizar reenvía siempre el código de barras (p_cambiar_codigo_barras)', () => {
    const p = aParametrosActualizar({ ...valido, codigo_barras: '7790001000015' }, { conCosto: false, id: 'p', actualizadoEn: 't' })
    expect(p).toMatchObject({ p_cambiar_codigo_barras: true, p_codigo_barras: '7790001000015' })
  })

  it('código de barras repetido: mensaje claro; otro 23505 no se confunde', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const repetido = { code: '23505', message: 'duplicate key value violates unique constraint "productos_org_codigo_barras_uidx"' }
    expect(esCodigoBarrasRepetido(repetido)).toBe(true)
    expect(esCodigoBarrasRepetido({ code: '23505', message: 'productos_org_sku_uidx' })).toBe(false)
    expect(mensajeDeError(repetido, 'x')).toBe('Ese código de barras ya existe')
  })

  it('mapea el rechazo de proveedor a un mensaje claro sin filtrar el detalle', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(mensajeDeError({ code: '22023', message: 'El proveedor no existe o está desactivado' }, 'x'))
      .toBe('Ese proveedor no está disponible. Elegí otro activo o dejá el campo vacío.')
  })
})
