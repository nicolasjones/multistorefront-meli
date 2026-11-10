import { describe, expect, it, vi } from 'vitest'
import { FILTROS_ACTIVIDAD_INICIALES } from './actividad'
import {
  armarCsvActividad,
  ExportacionIncompletaError,
  LOTE_EXPORTACION_ACTIVIDAD,
  nombreArchivoActividad,
  TOPE_FILAS_ACTIVIDAD,
  traerActividadParaExportar,
  type FilaExportacionActividad,
} from './exportarActividad'

const fila = (cambios: Partial<FilaExportacionActividad> = {}): FilaExportacionActividad => ({
  creado_en: '2026-10-01T02:30:00Z',
  tipo: 'producto.creado',
  empresa_id: 'e-1',
  empresa_nombre: 'Empresa A1',
  actor_nombre: 'Ana Admin',
  detalle: 'Creó el producto Lámpara',
  ...cambios,
})

describe('CSV de la actividad (F-AUD-03, FR-012)', () => {
  it('lleva BOM UTF-8, las columnas de la tabla y fin de línea CRLF', () => {
    const csv = armarCsvActividad([fila()])
    expect(csv.startsWith('﻿')).toBe(true)
    const lineas = csv.slice(1).split('\r\n')
    expect(lineas[0]).toBe('Cuándo;Tipo;Tienda;Detalle;Quién')
    expect(lineas[1]).toBe('30/09/2026 23:30;Producto creado;Empresa A1;Creó el producto Lámpara;Ana Admin')
    expect(csv.endsWith('\r\n')).toBe(true)
  })

  it('muestra la hora de Buenos Aires, no la UTC', () => {
    // 02:30 UTC del 01/10 es 23:30 del 30/09 en Buenos Aires.
    expect(armarCsvActividad([fila()])).toContain('30/09/2026 23:30')
  })

  it('usa los mismos textos que la tabla para tienda y autor ausentes', () => {
    const csv = armarCsvActividad([
      fila({ empresa_id: null, empresa_nombre: null, actor_nombre: null }),
      fila({ empresa_id: 'e-9', empresa_nombre: null }),
    ])
    expect(csv).toContain(';Compartido;')
    expect(csv).toContain(';Empresa no disponible;')
    expect(csv).toContain(';Sistema\r\n')
  })

  it('neutraliza las celdas que empiezan con = + - @ (inyección de fórmulas)', () => {
    for (const peligrosa of ['=SUMA(A1)', '+1', '-1', '@usuario']) {
      expect(armarCsvActividad([fila({ detalle: peligrosa })])).toContain(`'${peligrosa}`)
    }
  })

  it('escapa comillas, separadores y saltos de línea del detalle (CA-AUD-03-4)', () => {
    const csv = armarCsvActividad([fila({ detalle: 'Dijo "hola"; chau\nfin' })])
    expect(csv).toContain('"Dijo ""hola""; chau\nfin"')
  })

  it('el archivo se llama actividad-AAAA-MM-DD.csv con la fecha de la organización', () => {
    expect(nombreArchivoActividad(new Date('2026-10-05T12:00:00Z'))).toBe('actividad-2026-10-05.csv')
    // 01:00 UTC del 06/10 todavía es 05/10 en Buenos Aires.
    expect(nombreArchivoActividad(new Date('2026-10-06T01:00:00Z'))).toBe('actividad-2026-10-05.csv')
  })
})

describe('traerActividadParaExportar', () => {
  type Siguiente = { creado_en: string; id: string } | null
  const respuesta = (filas: FilaExportacionActividad[], opciones: { total?: number | null; hayMas?: boolean; siguiente?: Siguiente; corte?: string } = {}) => {
    const hayMas = opciones.hayMas ?? false
    return {
      data: {
        filas,
        total: opciones.total ?? null,
        tope: TOPE_FILAS_ACTIVIDAD,
        corte: opciones.corte ?? '2026-11-01T10:00:00Z',
        hay_mas: hayMas,
        siguiente: opciones.siguiente ?? (hayMas ? { creado_en: '2026-10-01T00:00:00Z', id: 'id-ult' } : null),
      },
      error: null,
    }
  }
  const lote = (n: number) => Array.from({ length: n }, () => fila())

  it('pide con los filtros de la pantalla, pide el total solo la primera vez y reenvía corte y cursor (sin entregadas: la base cuenta)', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce(respuesta(lote(LOTE_EXPORTACION_ACTIVIDAD), { total: 1500, hayMas: true, corte: 'corte-1' }))
      .mockResolvedValueOnce(respuesta(lote(500), { corte: 'corte-1' }))
    const filtros = { ...FILTROS_ACTIVIDAD_INICIALES, periodo: 'todo' as const, empresa: 'e-1', actor: 'u-1', tipo: 'producto.creado', texto: '  lámpara ' }

    const resultado = await traerActividadParaExportar({ rpc } as never, filtros, 'exp-1')

    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls[0]).toEqual(['exportar_actividad', {
      p_desde: null, p_hasta: null, p_empresa: 'e-1', p_actor: 'u-1', p_tipo: 'producto.creado', p_texto: 'lámpara',
      p_corte: null, p_cursor_creado_en: null, p_cursor_id: null, p_limite: LOTE_EXPORTACION_ACTIVIDAD,
      p_exportacion: 'exp-1', p_con_total: true,
    }])
    expect(rpc.mock.calls[1][1]).toMatchObject({
      p_corte: 'corte-1', p_cursor_creado_en: '2026-10-01T00:00:00Z', p_cursor_id: 'id-ult',
      p_exportacion: 'exp-1', p_con_total: false,
    })
    expect(rpc.mock.calls[1][1]).not.toHaveProperty('p_entregadas')
    expect(resultado.estado).toBe('completo')
    if (resultado.estado === 'completo') {
      expect(resultado.filas).toHaveLength(1500)
      expect(resultado.total).toBe(1500)
    }
  })

  it('manda el período como fechas y el texto vacío como null', async () => {
    const rpc = vi.fn().mockResolvedValue(respuesta([], { total: 0 }))
    await traerActividadParaExportar({ rpc } as never, { ...FILTROS_ACTIVIDAD_INICIALES, periodo: '7dias', texto: '   ' })
    const args = rpc.mock.calls[0][1]
    expect(args.p_desde).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(args.p_hasta).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(args.p_texto).toBeNull()
  })

  it('sin filas devuelve «vacio» tras una sola llamada', async () => {
    const rpc = vi.fn().mockResolvedValue(respuesta([], { total: 0 }))
    expect(await traerActividadParaExportar({ rpc } as never, FILTROS_ACTIVIDAD_INICIALES)).toEqual({ estado: 'vacio' })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('si el filtro supera el tope no baja más lotes ni devuelve filas (CA-AUD-03-3)', async () => {
    const rpc = vi.fn().mockResolvedValue(respuesta(lote(LOTE_EXPORTACION_ACTIVIDAD), { total: 80_000, hayMas: true }))
    const resultado = await traerActividadParaExportar({ rpc } as never, FILTROS_ACTIVIDAD_INICIALES)
    expect(resultado).toEqual({ estado: 'excede', total: 80_000 })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('con exactamente el tope exporta todo en lotes', async () => {
    const lotes = TOPE_FILAS_ACTIVIDAD / LOTE_EXPORTACION_ACTIVIDAD
    const rpc = vi.fn()
    for (let i = 0; i < lotes; i += 1) {
      rpc.mockResolvedValueOnce(respuesta(lote(LOTE_EXPORTACION_ACTIVIDAD), { total: i === 0 ? TOPE_FILAS_ACTIVIDAD : null, hayMas: i < lotes - 1 }))
    }
    const resultado = await traerActividadParaExportar({ rpc } as never, FILTROS_ACTIVIDAD_INICIALES)
    expect(rpc).toHaveBeenCalledTimes(lotes)
    expect(resultado.estado).toBe('completo')
  })

  it('si la base corta con filas pendientes lanza error y no entrega nada parcial', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce(respuesta(lote(LOTE_EXPORTACION_ACTIVIDAD), { total: 1500, hayMas: true }))
      .mockResolvedValueOnce(respuesta([], { hayMas: true }))
    await expect(traerActividadParaExportar({ rpc } as never, FILTROS_ACTIVIDAD_INICIALES)).rejects.toBeInstanceOf(ExportacionIncompletaError)
  })

  it('si al terminar llegaron menos filas que el total lanza error', async () => {
    const rpc = vi.fn().mockResolvedValue(respuesta(lote(3), { total: 10 }))
    await expect(traerActividadParaExportar({ rpc } as never, FILTROS_ACTIVIDAD_INICIALES)).rejects.toBeInstanceOf(ExportacionIncompletaError)
  })

  it('propaga el error de la base sin devolver un resultado parcial', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom', code: '42501' } })
    await expect(traerActividadParaExportar({ rpc } as never, FILTROS_ACTIVIDAD_INICIALES)).rejects.toMatchObject({ code: '42501' })
  })
})
