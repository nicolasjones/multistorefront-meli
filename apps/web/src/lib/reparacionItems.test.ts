import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  calcularSubtotal, CANTIDAD_MAXIMA_ITEM, descuentaStock, errorDeCampoItem, formularioItemVacio, LARGO_MAXIMO_DESCRIPCION_ITEM, mensajeDeErrorItem,
  MENSAJE_CANTIDAD, MENSAJE_PRECIO, MENSAJE_SIN_STOCK, MENSAJE_SOLO_LECTURA, notaDisponible, parsearCantidad, parsearPrecio, PRECIO_MAXIMO_ITEM,
  validarItem, type DepositoRepuesto, type FormularioItem, type ProductoRepuesto,
} from './reparacionItems'

const producto = (extra: Partial<ProductoRepuesto> = {}): ProductoRepuesto => ({ id: 'p1', nombre: 'Pantalla', sku: 'PAN-1', ...extra })
const item = (extra: Partial<FormularioItem> = {}): FormularioItem => ({ ...formularioItemVacio(), descripcion: 'Cambio de pantalla', precio: '25000', ...extra })

describe('cantidad de un ítem de reparación', () => {
  it.each([['1', 1], ['25', 25], [' 9999 ', CANTIDAD_MAXIMA_ITEM]])('lee %j como %d', (texto, valor) => {
    expect(parsearCantidad(texto)).toBe(valor)
  })

  it.each(['', '0', '00', '-1', '1,5', '10000', '12345', 'x', '1e2'])('rechaza %j', (texto) => {
    expect(parsearCantidad(texto)).toBeNull()
  })
})

describe('precio de un ítem de reparación', () => {
  it.each([
    ['0', 0],
    ['25000', 25000],
    ['25000,50', 25000.5],
    ['25000.5', 25000.5],
    ['0,01', 0.01],
    ['99999999,99', PRECIO_MAXIMO_ITEM],
  ])('lee %j como %d', (texto, valor) => {
    expect(parsearPrecio(texto)).toBe(valor)
  })

  it.each(['', ' ', '-1', '25.000,50', '1,234', 'abc', '100000000', '1e5', ',5'])('rechaza %j', (texto) => {
    expect(parsearPrecio(texto)).toBeNull()
  })
})

describe('subtotal en vivo del diálogo', () => {
  it('multiplica cantidad por precio y redondea a centavos', () => {
    expect(calcularSubtotal('3', '25000')).toBe(75000)
    expect(calcularSubtotal('3', '10,10')).toBe(30.3)
    expect(calcularSubtotal('3', '0,1')).toBe(0.3)
    expect(calcularSubtotal('7', '0,01')).toBe(0.07)
  })

  it('con la cantidad o el precio inválidos el subtotal es cero', () => {
    expect(calcularSubtotal('', '100')).toBe(0)
    expect(calcularSubtotal('0', '100')).toBe(0)
    expect(calcularSubtotal('2', '')).toBe(0)
    expect(calcularSubtotal('2', 'x')).toBe(0)
  })

  it('un precio en cero da subtotal cero (por ejemplo, una garantía)', () => {
    expect(calcularSubtotal('5', '0')).toBe(0)
  })

  it('el subtotal máximo posible no pierde precisión', () => {
    expect(calcularSubtotal(String(CANTIDAD_MAXIMA_ITEM), '99999999,99')).toBe(999899999900.01)
  })
})

describe('validación de un ítem de reparación', () => {
  it('un ítem de mano de obra correcto no tiene errores', () => {
    expect(validarItem(item(), 'mano_obra')).toEqual({})
  })

  it('la mano de obra exige un concepto; el repuesto, un producto o una descripción', () => {
    expect(validarItem(item({ descripcion: '  ' }), 'mano_obra').descripcion).toBe('Ingresá el concepto.')
    expect(validarItem(item({ descripcion: '' }), 'repuesto').descripcion).toBe('Elegí un producto o escribí el repuesto.')
  })

  it('un repuesto vinculado al catálogo no necesita descripción propia', () => {
    expect(validarItem(item({ descripcion: '', producto: producto() }), 'repuesto').descripcion).toBeUndefined()
  })

  it('la mano de obra no se salva con un producto elegido', () => {
    expect(validarItem(item({ descripcion: '', producto: producto() }), 'mano_obra').descripcion).toBe('Ingresá el concepto.')
  })

  it('la descripción tiene tope de largo', () => {
    expect(validarItem(item({ descripcion: 'a'.repeat(LARGO_MAXIMO_DESCRIPCION_ITEM) }), 'mano_obra').descripcion).toBeUndefined()
    expect(validarItem(item({ descripcion: 'a'.repeat(LARGO_MAXIMO_DESCRIPCION_ITEM + 1) }), 'mano_obra').descripcion).toBe(`Máximo ${LARGO_MAXIMO_DESCRIPCION_ITEM} caracteres.`)
  })

  it('la cantidad y el precio inválidos tienen cada uno su mensaje', () => {
    const errores = validarItem(item({ cantidad: '0', precio: '' }), 'mano_obra')
    expect(errores.cantidad).toBe(MENSAJE_CANTIDAD)
    expect(errores.precio).toBe(MENSAJE_PRECIO)
  })

  it('el formulario vacío arranca con cantidad 1 y sin producto ni depósito', () => {
    expect(formularioItemVacio()).toEqual({ descripcion: '', cantidad: '1', precio: '', producto: null, deposito_id: null })
  })
})

describe('repuestos y stock', () => {
  it('descuenta stock solo un producto del catálogo que no es «a pedido»', () => {
    expect(descuentaStock(producto())).toBe(true)
    expect(descuentaStock(producto({ disponibilidad_manual: null }))).toBe(true)
    expect(descuentaStock(producto({ disponibilidad_manual: 'a_pedido' }))).toBe(false)
    expect(descuentaStock(null)).toBe(false)
  })

  const deposito = (disponible: number): DepositoRepuesto => ({ deposito_id: 'd1', nombre: 'Central', por_defecto: true, cantidad: disponible, reservado: 0, disponible })

  it('la nota avisa la falta de stock solo cuando lo disponible es menor a la cantidad', () => {
    expect(notaDisponible(deposito(5), 5)).toBe('Disponible en Central: 5 u.')
    expect(notaDisponible(deposito(5), 3)).toBe('Disponible en Central: 5 u.')
    expect(notaDisponible(deposito(5), 6)).toBe('Disponible en Central: 5 u. (falta stock: pedí el repuesto al proveedor)')
    expect(notaDisponible(deposito(0), 1)).toContain('falta stock')
  })

  it('sin cantidad válida no hay aviso de falta de stock', () => {
    expect(notaDisponible(deposito(0), null)).toBe('Disponible en Central: 0 u.')
  })
})

describe('errores de los ítems', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined) })
  afterEach(() => { vi.restoreAllMocks() })

  it('apunta al campo solo con un 22023 que trae un hint conocido y un mensaje', () => {
    expect(errorDeCampoItem({ code: '22023', hint: 'cantidad', message: 'Cantidad inválida' })).toEqual({ campo: 'cantidad', mensaje: 'Cantidad inválida' })
    expect(errorDeCampoItem({ code: '22023', hint: 'deposito_id', message: 'x' })).toEqual({ campo: 'deposito_id', mensaje: 'x' })
    expect(errorDeCampoItem({ code: '22023', hint: 'otro', message: 'x' })).toBeNull()
    expect(errorDeCampoItem({ code: '22023', message: 'x' })).toBeNull()
    expect(errorDeCampoItem({ code: '22023', hint: 'precio' })).toBeNull()
    expect(errorDeCampoItem({ code: '23514', hint: 'precio', message: 'x' })).toBeNull()
    expect(errorDeCampoItem(null)).toBeNull()
  })

  it('traduce los códigos de la base', () => {
    expect(mensajeDeErrorItem({ code: '42501' }, 'x')).toContain('No tenés permiso para modificar los ítems')
    expect(mensajeDeErrorItem({ code: '55000' }, 'x')).toBe(MENSAJE_SOLO_LECTURA)
    expect(mensajeDeErrorItem({ code: '23514' }, 'x')).toBe(MENSAJE_SIN_STOCK)
    expect(mensajeDeErrorItem({ code: 'P0002' }, 'x')).toContain('ya no existe')
    expect(mensajeDeErrorItem({ code: '22023', message: 'Depósito inactivo' }, 'x')).toBe('Depósito inactivo')
  })

  it('un error desconocido o un 22023 sin mensaje usa el texto por defecto', () => {
    expect(mensajeDeErrorItem({ code: '22023' }, 'por defecto')).toBe('por defecto')
    expect(mensajeDeErrorItem({ code: 'XX000', message: 'detalle interno' }, 'por defecto')).toBe('por defecto')
    expect(mensajeDeErrorItem(undefined, 'por defecto')).toBe('por defecto')
  })
})
