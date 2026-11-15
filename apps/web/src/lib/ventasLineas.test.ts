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
  lineaEnPromocion,
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

describe('ventasLineas · precio promocional (F-2, FR-015/FR-016)', () => {
  it('una línea con precio_referencia numérico está en promoción y su rótulo es «promoción», sin escala ni descuento', () => {
    const enPromocion = linea({ precio_unitario: 900, precio_referencia: 1000, escala: 'x1', descuento_pct: 0 })
    expect(lineaEnPromocion(enPromocion)).toBe(true)
    expect(rotuloEscalaLinea(enPromocion)).toBe('promoción')
    // Aunque llegara un descuento, la promoción no lo muestra (no se aplicó).
    expect(rotuloEscalaLinea({ ...enPromocion, descuento_pct: 5 })).toBe('promoción')
  })

  it('sin referencia (null o ausente) no hay promoción y el rótulo no cambia', () => {
    expect(lineaEnPromocion(linea({ precio_referencia: null }))).toBe(false)
    expect(lineaEnPromocion(linea())).toBe(false)
    expect(rotuloEscalaLinea(linea({ precio_referencia: null }))).toBe('escala x10')
    expect(rotuloEscalaLinea(linea({ precio_referencia: null, descuento_pct: 5 }))).toBe('escala x10 · 5 % de descuento')
  })

  it('el precio manual y las líneas sin_stock nunca se muestran en promoción', () => {
    expect(lineaEnPromocion(linea({ precio_manual: true, precio_referencia: 1000 }))).toBe(false)
    expect(rotuloEscalaLinea(linea({ precio_manual: true, precio_referencia: 1000 }))).toBe('precio manual')
    expect(lineaEnPromocion(linea({ sin_stock: true, precio_referencia: 1000 }))).toBe(false)
  })

  it('mapea precio_referencia a número (o null) y descarta promocion_id si llegara', () => {
    const [con, sin, ausente] = aLineas([
      { id: 'a', precio_unitario: '900', precio_referencia: '1000.00', promocion_id: 'prom-1' },
      { id: 'b', precio_unitario: '900', precio_referencia: null },
      { id: 'c', precio_unitario: '900' },
    ])
    expect(con.precio_referencia).toBe(1000)
    expect(sin.precio_referencia).toBeNull()
    expect(ausente.precio_referencia).toBeNull()
    expect(con).not.toHaveProperty('promocion_id')
  })

  it('al reenviar las líneas no se manda la referencia ni la promoción (el servidor las ignora y recalcula)', () => {
    const [enviada] = aEntradas([linea({ precio_unitario: 900, precio_referencia: 1000 })])
    expect(enviada).toEqual({ producto_id: 'p-1', cantidad: 10, deposito_id: 'd-1', precio_manual: null })
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
