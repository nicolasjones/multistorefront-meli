import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('./supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import {
  estadoStockHoy,
  listarFaltantes,
  mensajeDeErrorFaltantes,
  registrarFaltantes,
  unidadesDisponibles,
  validarCantidadFaltante,
  MENSAJE_CANTIDAD_CERO,
  MENSAJE_CANTIDAD_EXCEDE,
  MENSAJE_CANTIDAD_NO_NUMERO,
  MENSAJE_CANTIDAD_VACIA,
  MENSAJE_CONFLICTO,
  MENSAJE_ERROR_LISTADO,
  MENSAJE_ERROR_REGISTRAR,
  MENSAJE_FUERA_DE_ESTADO,
  MENSAJE_SIN_PERMISO,
  type FaltanteVenta,
} from './ventasFaltantes'

const fila = (cambios: Partial<FaltanteVenta> = {}): FaltanteVenta => ({
  id: 'f-1',
  empresa_id: 'e-1',
  empresa: 'San Javucho',
  cliente: 'Cliente Uno',
  producto: 'Joystick',
  sku: 'JOY-1',
  cantidad_faltante: 3,
  linea_orden: 1,
  comprobante_id: 'c-1',
  comprobante: '0003-00001251',
  fecha: '2026-10-05',
  desde: '2026-10-07T10:00:00Z',
  stock_estado: 'sin_stock',
  stock_disponible: 0,
  ...cambios,
})

describe('ventasFaltantes · listado (FR-043, FR-044)', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
  })

  it('pide el listado a la RPC con el filtro de tienda y la página', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    await listarFaltantes({ empresaId: 'e-1', pagina: 2, tamano: 10 })
    expect(mocks.rpc).toHaveBeenCalledWith('listar_faltantes', {
      p_empresa_id: 'e-1',
      p_pagina: 2,
      p_tamano: 10,
    })
  })

  it('sin filtro de tienda pide todas las empresas accesibles', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    await listarFaltantes({ empresaId: null, pagina: 1, tamano: 10 })
    expect(mocks.rpc).toHaveBeenCalledWith('listar_faltantes', {
      p_empresa_id: null,
      p_pagina: 1,
      p_tamano: 10,
    })
  })

  it('normaliza los números de la fila y trae el total del filtro', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ ...fila(), cantidad_faltante: '3', linea_orden: '1', stock_disponible: '12', filas: '7' }],
      error: null,
    })
    const pagina = await listarFaltantes({ empresaId: null, pagina: 1, tamano: 10 })
    expect(pagina.total).toBe(7)
    expect(pagina.faltantes).toHaveLength(1)
    expect(pagina.faltantes[0].cantidad_faltante).toBe(3)
    expect(pagina.faltantes[0].linea_orden).toBe(1)
    expect(pagina.faltantes[0].stock_disponible).toBe(12)
  })

  it('sin filas no hay total', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    const pagina = await listarFaltantes({ empresaId: null, pagina: 3, tamano: 10 })
    expect(pagina.faltantes).toEqual([])
    expect(pagina.total).toBe(0)
  })

  it('propaga el error de la RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'sin permiso' } })
    await expect(listarFaltantes({ empresaId: null, pagina: 1, tamano: 10 })).rejects.toBeTruthy()
  })
})

describe('ventasFaltantes · «Stock hoy»', () => {
  it('rotula los estados de Stock con su variante', () => {
    expect(estadoStockHoy('sin_stock')).toEqual({ texto: 'Sin stock', variante: 'error' })
    expect(estadoStockHoy('stock_bajo')).toEqual({ texto: 'Stock bajo', variante: 'aviso' })
    expect(estadoStockHoy('disponible')).toEqual({ texto: 'Disponible', variante: 'exito' })
  })

  it('sin estado no inventa uno', () => {
    expect(estadoStockHoy(null)).toEqual({ texto: 'Sin dato', variante: 'neutral' })
    expect(estadoStockHoy(undefined)).toEqual({ texto: 'Sin dato', variante: 'neutral' })
  })

  it('las unidades disponibles en singular y plural', () => {
    expect(unidadesDisponibles(1)).toBe('1 unidad')
    expect(unidadesDisponibles(12)).toBe('12 unidades')
    expect(unidadesDisponibles(null)).toBe('—')
  })
})

describe('ventasFaltantes · registro de faltantes (FR-047)', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
  })

  it('manda línea y cantidad a la RPC con el bloqueo optimista', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await registrarFaltantes({
      comprobanteId: 'c-1',
      actualizadoEn: '2026-10-07T10:00:00Z',
      faltantes: [
        { linea_orden: 1, cantidad: 3 },
        { linea_orden: 2, cantidad: 1 },
      ],
    })
    expect(mocks.rpc).toHaveBeenCalledWith('registrar_faltantes_despacho', {
      p_id: 'c-1',
      p_faltantes: [
        { linea_orden: 1, cantidad: 3 },
        { linea_orden: 2, cantidad: 1 },
      ],
      p_actualizado_en: '2026-10-07T10:00:00Z',
    })
  })

  it('valida la cantidad contra lo pedido en la línea', () => {
    expect(validarCantidadFaltante('', 5)).toBe(MENSAJE_CANTIDAD_VACIA)
    expect(validarCantidadFaltante('muchas', 5)).toBe(MENSAJE_CANTIDAD_NO_NUMERO)
    expect(validarCantidadFaltante('1,5', 5)).toBe(MENSAJE_CANTIDAD_NO_NUMERO)
    expect(validarCantidadFaltante('0', 5)).toBe(MENSAJE_CANTIDAD_CERO)
    expect(validarCantidadFaltante('6', 5)).toBe(MENSAJE_CANTIDAD_EXCEDE)
    expect(validarCantidadFaltante('5', 5)).toBeNull()
    expect(validarCantidadFaltante(' 2 ', 5)).toBeNull()
  })
})

describe('ventasFaltantes · mensajes de error', () => {
  it('traduce el conflicto de edición, el permiso y el estado', () => {
    expect(mensajeDeErrorFaltantes({ code: '40001' }, MENSAJE_ERROR_REGISTRAR)).toBe(MENSAJE_CONFLICTO)
    expect(mensajeDeErrorFaltantes({ code: '42501' }, MENSAJE_ERROR_REGISTRAR)).toBe(MENSAJE_SIN_PERMISO)
    expect(mensajeDeErrorFaltantes({ code: '55000' }, MENSAJE_ERROR_REGISTRAR)).toBe(MENSAJE_FUERA_DE_ESTADO)
  })

  it('muestra el mensaje de la RPC cuando es de la lista', () => {
    const mensaje = 'La cantidad faltante de la línea 1 tiene que estar entre 1 y 5'
    expect(mensajeDeErrorFaltantes({ code: '22023', message: mensaje }, MENSAJE_ERROR_REGISTRAR)).toBe(mensaje)
  })

  it('un error desconocido cae en el mensaje por defecto', () => {
    expect(mensajeDeErrorFaltantes({ code: 'XX000', message: 'detalle interno' }, MENSAJE_ERROR_LISTADO)).toBe(
      MENSAJE_ERROR_LISTADO,
    )
  })
})
