import { describe, expect, it, vi } from 'vitest'
import {
  armarCsvProductos, campoCsv, columnasOfrecidas, columnasPorDefecto, exportarProductos, ExportacionCancelada, filtrosExportacion,
  type FilaExportacionProducto,
} from './exportarProductos'
import { CONSULTA_INICIAL } from './productosListado'

describe('columnas de exportación (FR-204)', () => {
  it('por defecto salen las ocho primeras; sin Rentabilidad el Costo no se ofrece', () => {
    expect(columnasPorDefecto(true)).toEqual(['sku', 'nombre', 'categoria', 'precio', 'costo', 'stock', 'visible_en', 'estado'])
    expect(columnasPorDefecto(false)).toEqual(['sku', 'nombre', 'categoria', 'precio', 'stock', 'visible_en', 'estado'])
  })

  it('Costo y Proveedor solo se ofrecen con acceso a Rentabilidad', () => {
    expect(columnasOfrecidas(false).map((c) => c.clave)).toEqual(['sku', 'nombre', 'categoria', 'precio', 'stock', 'visible_en', 'estado', 'codigo_barras'])
    expect(columnasOfrecidas(true).map((c) => c.clave)).toEqual(expect.arrayContaining(['costo', 'proveedor']))
  })
})

describe('CSV de productos (FR-207)', () => {
  it('escapa comillas, comas, punto y coma y saltos de línea', () => {
    expect(campoCsv('Cable "USB"')).toBe('"Cable ""USB"""')
    expect(campoCsv('a, b')).toBe('"a, b"')
    expect(campoCsv('a;b')).toBe('"a;b"')
    expect(campoCsv('línea 1\nlínea 2')).toBe('"línea 1\nlínea 2"')
    expect(campoCsv('simple')).toBe('simple')
  })

  it.each(['=SUMA(A1)', '+1', '-1', '@cmd'])('neutraliza la fórmula %s', (valor) => {
    expect(campoCsv(valor)).toBe(`'${valor}`)
  })

  it('arma solo las columnas pedidas, con BOM y etiquetas', () => {
    const filas: FilaExportacionProducto[] = [
      { id: '1', sku: '=X', nombre: 'Joystick, azul', categoria: null, precio: { monto: '49.90', moneda: 'USD' }, stock: 'sin_stock', visible_en: ['Norte', 'Sur'], estado: 'Activo' },
    ]
    const csv = armarCsvProductos(['sku', 'nombre', 'categoria', 'precio', 'stock', 'visible_en', 'estado'], filas)
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv.split('\r\n')).toEqual([
      '﻿SKU;Nombre;Categoría;Precio;Stock;Visible en;Estado',
      '\'=X;"Joystick, azul";;USD 49.90;Sin stock;"Norte, Sur";Activo',
      '',
    ])
  })

  it('no incluye costo si no se pidió la columna', () => {
    const csv = armarCsvProductos(['sku'], [{ id: '1', sku: 'A', costo: { monto: 20 } }])
    expect(csv).not.toContain('20')
  })
})

describe('filtros de exportación (FR-202)', () => {
  const consulta = { ...CONSULTA_INICIAL, texto: ' joy ', estado: 'inactivos' as const, empresaId: 'emp-1', categoriaId: 'cat-1', disponibilidad: 'stock' as const }

  it('«Lo filtrado» respeta búsqueda, estado, categoría y empresa activa', () => {
    expect(filtrosExportacion(consulta, false)).toEqual({
      busqueda: 'joy', categoria_id: 'cat-1', estado: 'inactivos', empresa_id: 'emp-1', disponibilidad: 'stock', compatible: [],
    })
  })

  it('«Lo filtrado» manda el filtro «Compatible con» tal como lo usa el listado', () => {
    const filtrado = { ...consulta, compatibles: ['PS5', 'ps5', 'PlayStation 5'] }
    expect(filtrosExportacion(filtrado, false)).toMatchObject({ compatible: ['PS5', 'ps5', 'PlayStation 5'] })
    expect(filtrosExportacion(filtrado, true)).toEqual({ todos: true })
  })

  it('«Todos» no manda filtros', () => {
    expect(filtrosExportacion(consulta, true)).toEqual({ todos: true })
  })
})

describe('exportarProductos', () => {
  it('concatena las páginas por cursor y reporta el progreso', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { filas: [{ id: '1', sku: 'A' }], siguiente: '1', total: 2 }, error: null })
      .mockResolvedValueOnce({ data: { filas: [{ id: '2', sku: 'B' }], siguiente: null, total: 2 }, error: null })
    const progreso = vi.fn()
    const resultado = await exportarProductos({ rpc } as never, { filtros: { todos: true }, columnas: ['sku'], alProgresar: progreso })
    expect(rpc.mock.calls.map((c) => c[1].p_desde)).toEqual([null, '1'])
    expect(rpc.mock.calls[0][0]).toBe('exportar_productos')
    expect(progreso.mock.calls).toEqual([[1, 2], [2, 2]])
    expect(resultado).toMatchObject({ productos: 2, columnas: 1 })
    expect(resultado.csv).toContain('A\r\nB')
  })

  it('pide el total solo en la primera página y lleva la cuenta de lo entregado para el tope', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { filas: [{ id: '1', sku: 'A' }], siguiente: '1', total: 2, tope: 50000, recortado: false }, error: null })
      .mockResolvedValueOnce({ data: { filas: [{ id: '2', sku: 'B' }], siguiente: null, total: null, tope: 50000, recortado: null }, error: null })
    const progreso = vi.fn()
    const resultado = await exportarProductos({ rpc } as never, { filtros: {}, columnas: ['sku'], alProgresar: progreso })
    expect(rpc.mock.calls.map((c) => [c[1].p_entregadas, c[1].p_con_total])).toEqual([[0, true], [1, false]])
    // El total de la primera página se conserva para el progreso de las siguientes.
    expect(progreso.mock.calls).toEqual([[1, 2], [2, 2]])
    expect(resultado).toMatchObject({ productos: 2, recortado: false, tope: 50000 })
  })

  it('avisa cuando el filtro superaba el tope del archivo (recortado)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { filas: [{ id: '1', sku: 'A' }], siguiente: null, total: 60000, tope: 50000, recortado: true }, error: null })
    const progreso = vi.fn()
    const resultado = await exportarProductos({ rpc } as never, { filtros: {}, columnas: ['sku'], alProgresar: progreso })
    expect(resultado).toMatchObject({ recortado: true, tope: 50000 })
    // El progreso nunca promete más que el tope.
    expect(progreso).toHaveBeenCalledWith(1, 50000)
  })

  it('propaga el error de la base y respeta la cancelación', async () => {
    await expect(exportarProductos({ rpc: vi.fn().mockResolvedValue({ data: null, error: new Error('42501') }) } as never, { filtros: {}, columnas: ['sku'] })).rejects.toThrow('42501')
    const control = new AbortController()
    control.abort()
    await expect(exportarProductos({ rpc: vi.fn() } as never, { filtros: {}, columnas: ['sku'], signal: control.signal })).rejects.toBeInstanceOf(ExportacionCancelada)
  })
})
