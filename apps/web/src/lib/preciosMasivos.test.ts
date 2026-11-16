import { describe, expect, it, vi } from 'vitest'
import { analizarCsv } from './migracionCsv'
import {
  aplicarActualizacion,
  leerPlanilla,
  leerPorcentaje,
  MAXIMO_FILAS_PLANILLA,
  mensajeErrorActualizacion,
  MENSAJE_CONFLICTO,
  plantillaCsv,
  previsualizarActualizacion,
  versionesDe,
  type VistaPrevia,
} from './preciosMasivos'

describe('plantilla de actualización de precios (FR-003)', () => {
  it('trae las columnas SKU, costo y precio_lista', () => {
    expect(plantillaCsv()).toBe('SKU,costo,precio_lista\n')
  })

  it('la plantilla vuelve a leerse como planilla vacía', () => {
    expect(() => leerPlanilla(analizarCsv(plantillaCsv()), true)).toThrow()
  })
})

describe('leerPlanilla (FR-003, FR-006)', () => {
  it('lee coma como separador y decimales con punto', () => {
    const { filas, errores } = leerPlanilla(analizarCsv('SKU,costo,precio_lista\nA-1,10.5,20\nA-2,,30.25\n'), true)
    expect(errores).toEqual([])
    expect(filas).toEqual([
      { fila: 2, sku: 'A-1', costo: 10.5, precio_lista: 20 },
      { fila: 3, sku: 'A-2', precio_lista: 30.25 },
    ])
  })

  it('lee punto y coma con coma decimal, BOM y CRLF', () => {
    const { filas, errores } = leerPlanilla(analizarCsv('﻿SKU;costo;precio_lista\r\nA-1;10,5;20,75\r\n'), true)
    expect(errores).toEqual([])
    expect(filas).toEqual([{ fila: 2, sku: 'A-1', costo: 10.5, precio_lista: 20.75 }])
  })

  it('el tope es de 5.000 filas: con 5.000 lee, con 5.001 avisa', () => {
    const csv = (n: number) => `SKU,precio_lista\n${Array.from({ length: n }, (_, i) => `S-${i},1`).join('\n')}\n`
    expect(MAXIMO_FILAS_PLANILLA).toBe(5000)
    expect(leerPlanilla(analizarCsv(csv(5000)), true).filas).toHaveLength(5000)
    expect(() => leerPlanilla(analizarCsv(csv(5001)), true)).toThrow('La planilla admite hasta 5.000 filas por vez.')
  })

  it('la columna SKU es obligatoria', () => {
    expect(() => leerPlanilla(analizarCsv('costo,precio_lista\n1,2\n'), true)).toThrow('Falta la columna SKU')
  })

  it('exige al menos costo o precio_lista', () => {
    expect(() => leerPlanilla(analizarCsv('SKU\nA-1\n'), true)).toThrow('costo o precio_lista')
  })

  it('informa por fila, con su número, el SKU vacío, el número inválido y la fila sin importes', () => {
    const { filas, errores } = leerPlanilla(analizarCsv('SKU,costo,precio_lista\n,1,2\nA-2,abc,2\nA-3,,\nA-4,1,2\n'), true)
    expect(filas).toEqual([{ fila: 5, sku: 'A-4', costo: 1, precio_lista: 2 }])
    expect(errores).toEqual([
      { fila: 2, motivo: 'Falta el SKU.' },
      { fila: 3, motivo: 'El costo no es un número válido (hasta 2 decimales, sin IVA).' },
      { fila: 4, motivo: 'Cargá el costo, el precio de lista o ambos.' },
    ])
  })

  it('sin permiso de costos, una fila con costo es un error y la de solo lista pasa', () => {
    const { filas, errores } = leerPlanilla(analizarCsv('SKU,costo,precio_lista\nA-1,5,10\nA-2,,10\n'), false)
    expect(filas).toEqual([{ fila: 3, sku: 'A-2', precio_lista: 10 }])
    expect(errores).toEqual([{ fila: 2, motivo: 'Tu rol no puede cargar costos: quitá la columna costo.' }])
  })

  it('reconoce encabezados con otras mayúsculas o espacios', () => {
    const { filas } = leerPlanilla(analizarCsv('sku, Precio Lista\nA-1,5\n'), true)
    expect(filas).toEqual([{ fila: 2, sku: 'A-1', precio_lista: 5 }])
  })
})

describe('leerPorcentaje (FR-002)', () => {
  it.each([['10', 10], ['-5,5', -5.5], ['0', 0], ['-99.99', -99.99]])('acepta %s', (texto, esperado) => {
    expect(leerPorcentaje(texto)).toBe(esperado)
  })
  it.each(['', 'abc', '-100', '-150', '1e3'])('rechaza «%s»', (texto) => {
    expect(leerPorcentaje(texto)).toBeNull()
  })
})

describe('llamadas a las RPC y errores', () => {
  const vista: VistaPrevia = {
    afectados: 1, sin_cambio: 0, con_error: 0,
    filas: [{ fila: null, producto_id: 'p-1', sku: 'A', nombre: 'A', moneda: 'ARS', lista_antes: 1, lista_despues: 2, actualizado: '2026-11-07T10:00:00.123456+00:00', error: null, cambia: true }],
  }

  it('previsualizar envía modo y parámetros', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: vista, error: null })
    const parametros = { cambia: 'precio_lista' as const, alcance: 'todos', porcentaje: 10 }
    await expect(previsualizarActualizacion({ rpc } as never, 'porcentaje', parametros)).resolves.toEqual(vista)
    expect(rpc).toHaveBeenCalledWith('previsualizar_actualizacion_precios', { p_modo: 'porcentaje', p_parametros: parametros })
  })

  it('aplicar reenvía las versiones de la vista previa y la clave de la operación', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { lote_id: 'l-1', aplicados: 1, repetido: false }, error: null })
    const parametros = { filas: [{ fila: 2, sku: 'A', precio_lista: 2 }] }
    await aplicarActualizacion({ rpc } as never, 'planilla', parametros, vista, 'clave-1')
    expect(rpc).toHaveBeenCalledWith('aplicar_actualizacion_precios', {
      p_modo: 'planilla',
      p_parametros: { ...parametros, versiones: { 'p-1': '2026-11-07T10:00:00.123456+00:00' } },
      p_clave: 'clave-1',
    })
    expect(versionesDe(vista)).toEqual({ 'p-1': '2026-11-07T10:00:00.123456+00:00' })
  })

  it('un error de la base se propaga', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: '40001', message: 'x' } })
    await expect(aplicarActualizacion({ rpc } as never, 'planilla', { filas: [] }, vista, 'c')).rejects.toMatchObject({ code: '40001' })
  })

  it('el error 54000 del tope trae su texto en castellano', () => {
    expect(mensajeErrorActualizacion({ code: '54000', message: 'La actualización admite hasta 5.000 productos por vez; elegí una categoría' }))
      .toBe('La actualización admite hasta 5.000 productos por vez; elegí una categoría')
  })

  it('mapea los errores a mensajes claros', () => {
    expect(mensajeErrorActualizacion({ code: '40001' })).toBe(MENSAJE_CONFLICTO)
    expect(mensajeErrorActualizacion({ code: '42501', message: 'Tu rol no puede actualizar precios' })).toBe('Tu rol no puede actualizar precios')
    expect(mensajeErrorActualizacion({ code: 'XX000', message: 'interno: relation foo' })).not.toContain('relation')
  })
})
