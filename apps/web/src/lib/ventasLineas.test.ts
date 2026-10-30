import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('./supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import {
  aEntradas,
  aLineas,
  conCambio,
  conProductoAgregado,
  disponibleDeLinea,
  disponibleParaVenta,
  guardarLineasComprobante,
  hayFaltante,
  mensajeFaltante,
  parsearCantidadLinea,
  parsearPrecioLinea,
  rotuloEscalaLinea,
  sinLinea,
  type EntradaLinea,
  type LineaComprobante,
} from './ventasLineas'

const linea = (cambios: Partial<LineaComprobante> = {}): LineaComprobante => ({
  id: 'l-1',
  orden: 1,
  producto_id: 'p-1',
  descripcion: 'Joystick',
  codigo: 'JOY-1',
  cantidad: 10,
  precio_unitario: 800,
  escala: 'x10',
  precio_manual: false,
  alicuota_porcentaje: 21,
  deposito_id: 'd-1',
  deposito: 'Principal',
  a_pedido: false,
  stock: 10,
  reservado: 3,
  subtotal_sin_iva: 8000,
  iva: 1680,
  ...cambios,
})

const entrada = (cambios: Partial<EntradaLinea> = {}): EntradaLinea => ({
  producto_id: 'p-1',
  cantidad: 1,
  deposito_id: 'd-1',
  precio_manual: null,
  ...cambios,
})

describe('ventasLineas · disponible y faltante (FR-017, FR-018)', () => {
  it('el disponible es existencias del depósito menos lo reservado, nunca negativo', () => {
    expect(disponibleDeLinea(linea())).toBe(7)
    expect(disponibleDeLinea(linea({ stock: 2, reservado: 5 }))).toBe(0)
  })

  it('hay faltante solo si la cantidad supera el disponible', () => {
    expect(hayFaltante(linea({ cantidad: 7 }))).toBe(false)
    expect(hayFaltante(linea({ cantidad: 8 }))).toBe(true)
  })

  it('un producto «A pedido» no tiene faltante: no descuenta stock', () => {
    expect(hayFaltante(linea({ a_pedido: true, cantidad: 99 }))).toBe(false)
  })

  it('el mensaje de faltante nombra el disponible, el depósito y la cantidad pedida', () => {
    expect(mensajeFaltante(linea({ cantidad: 9 }))).toContain('Hay 7 disponibles en Principal')
    expect(mensajeFaltante(linea({ cantidad: 9 }))).toContain('la línea pide 9')
  })

  it('rotula la escala aplicada o el precio manual', () => {
    expect(rotuloEscalaLinea(linea())).toBe('escala x10')
    expect(rotuloEscalaLinea(linea({ precio_manual: true }))).toBe('precio manual')
  })

  it('muestra el descuento del cliente aplicado a la escala (F-VTA-32)', () => {
    expect(rotuloEscalaLinea(linea({ descuento_pct: 5 }))).toBe('escala x10 · 5 % de descuento')
    expect(rotuloEscalaLinea(linea({ descuento_pct: 0 }))).toBe('escala x10')
    expect(rotuloEscalaLinea(linea({ descuento_pct: 5, precio_manual: true }))).toBe('precio manual')
  })
})

describe('ventasLineas · entradas y edición', () => {
  it('manda el precio manual solo cuando la línea es manual', () => {
    expect(aEntradas([linea(), linea({ precio_manual: true, precio_unitario: 950 })])).toEqual([
      { producto_id: 'p-1', cantidad: 10, deposito_id: 'd-1', precio_manual: null },
      { producto_id: 'p-1', cantidad: 10, deposito_id: 'd-1', precio_manual: 950 },
    ])
  })

  it('agregar el mismo producto desde el mismo depósito suma una unidad; otro depósito crea línea', () => {
    const lista = conProductoAgregado([entrada({ cantidad: 2 })], 'p-1', 'd-1')
    expect(lista).toHaveLength(1)
    expect(lista[0].cantidad).toBe(3)
    expect(conProductoAgregado(lista, 'p-1', 'd-2')).toHaveLength(2)
  })

  it('no fusiona con una línea de precio manual', () => {
    const lista = conProductoAgregado([entrada({ cantidad: 2, precio_manual: 950 })], 'p-1', 'd-1')
    expect(lista).toHaveLength(2)
  })

  it('cambia, quita y limita la cantidad a un entero positivo', () => {
    const lista = [entrada({ cantidad: 1 }), entrada({ producto_id: 'p-2' })]
    expect(conCambio(lista, 0, { cantidad: 5 })[0].cantidad).toBe(5)
    expect(sinLinea(lista, 1)).toHaveLength(1)
    expect(parsearCantidadLinea('0')).toBeNull()
    expect(parsearCantidadLinea('2,5')).toBeNull()
    expect(parsearCantidadLinea('12')).toBe(12)
  })

  it('el precio vacío quita el manual; un valor inválido no se acepta', () => {
    expect(parsearPrecioLinea('')).toBeNull()
    expect(parsearPrecioLinea('1234,56')).toBe(1234.56)
    expect(parsearPrecioLinea('-1')).toBeUndefined()
    expect(parsearPrecioLinea('1,234')).toBeUndefined()
  })

  it('normaliza los números que llegan de la base', () => {
    const [normalizada] = aLineas([
      { id: 'l-1', cantidad: '3', precio_unitario: '800.50', stock: '10', reservado: '2', subtotal_sin_iva: '2401.5', iva: '504.32' },
    ])
    expect(normalizada.cantidad).toBe(3)
    expect(normalizada.precio_unitario).toBe(800.5)
    expect(normalizada.stock).toBe(10)
    expect(normalizada.reservado).toBe(2)
    expect(normalizada.subtotal_sin_iva).toBe(2401.5)
    expect(normalizada.iva).toBe(504.32)
    expect(aLineas(null)).toEqual([])
  })
})

describe('ventasLineas · base', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
  })

  it('guarda las líneas con el token de bloqueo optimista', async () => {
    mocks.rpc.mockResolvedValue({ error: null })
    await guardarLineasComprobante('k-1', [entrada()], '2026-10-24T10:00:00Z')
    expect(mocks.rpc).toHaveBeenCalledWith('guardar_lineas_comprobante', {
      p_id: 'k-1',
      p_lineas: [entrada()],
      p_actualizado_en: '2026-10-24T10:00:00Z',
    })
  })

  it('propaga el error de la base', async () => {
    const error = { code: '40001', message: 'conflicto' }
    mocks.rpc.mockResolvedValue({ error })
    await expect(guardarLineasComprobante('k-1', [], '2026-10-24T10:00:00Z')).rejects.toBe(error)
  })

  it('devuelve el disponible y null cuando la base no encuentra el producto o el depósito', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: 7, error: null })
    await expect(disponibleParaVenta('p-1', 'd-1')).resolves.toBe(7)
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null })
    await expect(disponibleParaVenta('p-1', 'd-2')).resolves.toBeNull()
    expect(mocks.rpc).toHaveBeenCalledWith('disponible_para_venta', { p_producto_id: 'p-1', p_deposito_id: 'd-1' })
  })
})
