import { describe, expect, it, vi } from 'vitest'
import {
  COLUMNAS_EXPORTACION, ExportacionCancelada, TAMANO_PAGINA_EXPORTACION, armarCsvProductos, campoCsv, columnasOfrecidas, columnasPorDefecto, exportarProductos,
  filtrosExportacion, nombreArchivoProductos,
} from './exportarProductos'
import { CONSULTA_INICIAL } from './productosListado'

describe('columnas', () => {
  it('sin acceso a Rentabilidad no se ofrecen costo ni proveedor', () => {
    expect(columnasOfrecidas(false).map((c) => c.clave)).not.toContain('costo')
    expect(columnasOfrecidas(false).map((c) => c.clave)).not.toContain('proveedor')
    expect(columnasOfrecidas(true)).toHaveLength(COLUMNAS_EXPORTACION.length)
  })

  it('por defecto son ocho con Rentabilidad y siete sin ella', () => {
    expect(columnasPorDefecto(true)).toHaveLength(8)
    expect(columnasPorDefecto(false)).toHaveLength(7)
    expect(columnasPorDefecto(true)).not.toContain('codigo_barras')
  })
})

describe('campoCsv', () => {
  it('escapa comillas, separadores, comas y saltos de línea', () => {
    expect(campoCsv('')).toBe('')
    expect(campoCsv('simple')).toBe('simple')
    expect(campoCsv('a;b')).toBe('"a;b"')
    expect(campoCsv('dice "hola"')).toBe('"dice ""hola"""')
    expect(campoCsv('a\nb')).toBe('"a\nb"')
  })

  it('neutraliza las fórmulas antes de escapar', () => {
    expect(campoCsv('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(campoCsv('@cmd')).toBe("'@cmd")
    expect(campoCsv('-5;x')).toBe('"\'-5;x"')
  })
})

describe('armarCsvProductos', () => {
  it('respeta el orden del catálogo de columnas, no el de las claves pedidas', () => {
    const csv = armarCsvProductos(['nombre', 'sku'], [{ id: '1', sku: 'S-1', nombre: 'Cable' }])
    expect(csv).toBe('﻿SKU;Nombre\r\nS-1;Cable\r\n')
  })

  it('arma precio con moneda, costo vacío si es nulo, visible en unido y stock con su etiqueta; un stock desconocido queda vacío', () => {
    const csv = armarCsvProductos(['precio', 'costo', 'stock', 'visible_en'], [
      { id: '1', precio: { monto: 10.5, moneda: 'ARS' }, costo: { monto: null }, visible_en: ['A', 'B'], stock: 'sin_stock' },
      { id: '2', precio: null, costo: { monto: 3 }, visible_en: [] },
    ])
    const lineas = csv.replace('﻿', '').trim().split('\r\n')
    expect(lineas[0]).toBe('Precio;Costo;Stock;Visible en')
    expect(lineas[1]).toBe('ARS 10.5;;Sin stock;"A, B"')
    expect(lineas[2]).toBe(';3;;')
  })
})

describe('filtrosExportacion y nombreArchivoProductos', () => {
  it('«todos» ignora el resto de los filtros', () => {
    expect(filtrosExportacion({ ...CONSULTA_INICIAL, texto: 'x' }, true)).toEqual({ todos: true })
  })

  it('«filtrado» replica la consulta y manda null si la búsqueda está en blanco', () => {
    const filtros = filtrosExportacion({ ...CONSULTA_INICIAL, texto: '  ', empresaId: 'e1', compatibles: ['ps5'] }, false)
    expect(filtros).toMatchObject({ busqueda: null, empresa_id: 'e1', compatible: ['ps5'], estado: 'todos' })
    expect(filtrosExportacion({ ...CONSULTA_INICIAL, texto: ' cable ' }, false).busqueda).toBe('cable')
  })

  it('«Stock bajo» viaja como stock_bajo solo cuando está activo', () => {
    expect(filtrosExportacion({ ...CONSULTA_INICIAL, stockBajo: true }, false)).toMatchObject({ stock_bajo: true })
    expect('stock_bajo' in filtrosExportacion({ ...CONSULTA_INICIAL, stockBajo: false }, false)).toBe(false)
    expect(filtrosExportacion({ ...CONSULTA_INICIAL, stockBajo: true }, true)).toEqual({ todos: true })
  })

  it('el nombre del archivo lleva la fecha de la organización', () => {
    expect(nombreArchivoProductos(new Date('2026-11-17T15:00:00Z'))).toBe('productos-2026-11-17.csv')
  })
})

describe('exportarProductos', () => {
  const pagina = (filas: unknown[], extra: Record<string, unknown> = {}) => ({ data: { filas, siguiente: null, total: null, tope: 50000, recortado: null, ...extra }, error: null })

  it('concatena las páginas por cursor y pide el total solo en la primera', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce(pagina([{ id: '1', nombre: 'A' }], { siguiente: 'cur', total: 2 }))
      .mockResolvedValueOnce(pagina([{ id: '2', nombre: 'B' }]))
    const progreso = vi.fn()
    const resultado = await exportarProductos({ rpc } as never, { filtros: { todos: true }, columnas: ['nombre'], alProgresar: progreso })
    expect(resultado).toMatchObject({ productos: 2, columnas: 1, recortado: false, tope: 50000 })
    expect(resultado.csv).toContain('A\r\nB')
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_desde: null, p_con_total: true, p_entregadas: 0, p_limite: TAMANO_PAGINA_EXPORTACION })
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_desde: 'cur', p_con_total: false, p_entregadas: 1 })
    expect(progreso).toHaveBeenLastCalledWith(2, 2)
  })

  it('informa si el filtro superó el tope del archivo', async () => {
    const rpc = vi.fn().mockResolvedValue(pagina([{ id: '1', nombre: 'A' }], { total: 99, tope: 1, recortado: true }))
    const resultado = await exportarProductos({ rpc } as never, { filtros: {}, columnas: ['nombre'] })
    expect(resultado).toMatchObject({ recortado: true, tope: 1 })
  })

  it('se cancela antes de pedir si la señal ya está abortada y propaga errores de la base', async () => {
    const rpc = vi.fn()
    const control = new AbortController()
    control.abort()
    await expect(exportarProductos({ rpc } as never, { filtros: {}, columnas: ['nombre'], signal: control.signal })).rejects.toBeInstanceOf(ExportacionCancelada)
    expect(rpc).not.toHaveBeenCalled()
    await expect(exportarProductos({ rpc: async () => ({ data: null, error: { code: '42501' } }) } as never, { filtros: {}, columnas: ['nombre'] })).rejects.toMatchObject({ code: '42501' })
  })
})
