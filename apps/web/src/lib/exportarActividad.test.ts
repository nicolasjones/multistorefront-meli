import { describe, expect, it, vi } from 'vitest'
import { FILTROS_ACTIVIDAD_INICIALES } from './actividad'
import {
  ExportacionIncompletaError, LOTE_EXPORTACION_ACTIVIDAD, TOPE_FILAS_ACTIVIDAD, armarCsvActividad, nombreArchivoActividad, traerActividadParaExportar, type FilaExportacionActividad,
} from './exportarActividad'

const fila = (i: number): FilaExportacionActividad => ({ creado_en: '2026-11-10T15:00:00Z', tipo: 'x', empresa_id: null, empresa_nombre: null, actor_nombre: null, detalle: `d${i}` })
const respuesta = (filas: FilaExportacionActividad[], extra: Record<string, unknown> = {}) => ({
  data: { filas, total: null, tope: TOPE_FILAS_ACTIVIDAD, corte: 'c1', hay_mas: false, siguiente: null, ...extra }, error: null,
})
const filtros = { ...FILTROS_ACTIVIDAD_INICIALES, periodo: 'todo' as const, texto: '  ' }

describe('traerActividadParaExportar', () => {
  it('un filtro sin filas es «vacío»', async () => {
    const rpc = vi.fn().mockResolvedValue(respuesta([], { total: 0 }))
    await expect(traerActividadParaExportar({ rpc } as never, filtros, 'exp-1')).resolves.toEqual({ estado: 'vacio' })
  })

  it('un filtro sobre el tope pide acotar y no baja filas', async () => {
    const rpc = vi.fn().mockResolvedValue(respuesta([], { total: TOPE_FILAS_ACTIVIDAD + 1 }))
    await expect(traerActividadParaExportar({ rpc } as never, filtros, 'exp-1')).resolves.toEqual({ estado: 'excede', total: TOPE_FILAS_ACTIVIDAD + 1 })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('pagina con cursor y mismo corte, pide el total solo en la primera y recorta el texto en blanco', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce(respuesta([fila(1), fila(2)], { total: 3, hay_mas: true, siguiente: { creado_en: 't', id: 'i2' } }))
      .mockResolvedValueOnce(respuesta([fila(3)]))
    const resultado = await traerActividadParaExportar({ rpc } as never, filtros, 'exp-1')
    expect(resultado).toMatchObject({ estado: 'completo', total: 3 })
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_texto: null, p_corte: null, p_con_total: true, p_limite: LOTE_EXPORTACION_ACTIVIDAD, p_exportacion: 'exp-1' })
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_corte: 'c1', p_cursor_creado_en: 't', p_cursor_id: 'i2', p_con_total: false })
  })

  it('nunca entrega un archivo parcial: falla si falta el cursor o si el conteo no coincide', async () => {
    const sinCursor = vi.fn().mockResolvedValue(respuesta([fila(1)], { total: 5, hay_mas: true, siguiente: null }))
    await expect(traerActividadParaExportar({ rpc: sinCursor } as never, filtros, 'e')).rejects.toBeInstanceOf(ExportacionIncompletaError)
    const faltan = vi.fn().mockResolvedValue(respuesta([fila(1)], { total: 2 }))
    await expect(traerActividadParaExportar({ rpc: faltan } as never, filtros, 'e')).rejects.toThrow(/Se esperaban 2 filas y llegaron 1/)
  })

  it('propaga el error de la base', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: '22023' } })
    await expect(traerActividadParaExportar({ rpc } as never, filtros, 'e')).rejects.toMatchObject({ code: '22023' })
  })
})

describe('CSV', () => {
  it('el encabezado respeta las columnas y el orden de la tabla', () => {
    const csv = armarCsvActividad([fila(1)]).replace('﻿', '')
    expect(csv.split('\r\n')[0]).toBe('Cuándo;Tipo;Tienda;Detalle;Quién')
  })

  it('el nombre del archivo lleva la fecha', () => {
    expect(nombreArchivoActividad(new Date('2026-11-17T15:00:00Z'))).toBe('actividad-2026-11-17.csv')
  })
})
