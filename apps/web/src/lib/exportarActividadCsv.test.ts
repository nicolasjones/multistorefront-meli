import { describe, expect, it, vi } from 'vitest'
import { FILTROS_ACTIVIDAD_INICIALES } from './actividad'
import {
  armarCsvActividad,
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
  const respuesta = (filas: FilaExportacionActividad[], total: number, corte = '2026-11-01T10:00:00Z') =>
    ({ data: { filas, total, tope: TOPE_FILAS_ACTIVIDAD, recortado: total > TOPE_FILAS_ACTIVIDAD, corte }, error: null })

  it('pide con los filtros de la pantalla y reenvía el corte y el desplazamiento en cada lote', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce(respuesta(Array.from({ length: LOTE_EXPORTACION_ACTIVIDAD }, () => fila()), 1500, 'corte-1'))
      .mockResolvedValueOnce(respuesta(Array.from({ length: 500 }, () => fila()), 1500, 'corte-2'))
    const filtros = { ...FILTROS_ACTIVIDAD_INICIALES, periodo: 'todo' as const, empresa: 'e-1', actor: 'u-1', tipo: 'producto.creado', texto: '  lámpara ' }

    const resultado = await traerActividadParaExportar({ rpc } as never, filtros)

    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls[0]).toEqual(['exportar_actividad', {
      p_desde: null, p_hasta: null, p_empresa: 'e-1', p_actor: 'u-1', p_tipo: 'producto.creado', p_texto: 'lámpara',
      p_corte: null, p_desplazamiento: 0, p_limite: LOTE_EXPORTACION_ACTIVIDAD,
    }])
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_corte: 'corte-1', p_desplazamiento: LOTE_EXPORTACION_ACTIVIDAD })
    expect(resultado.filas).toHaveLength(1500)
    expect(resultado.total).toBe(1500)
    expect(resultado.recortado).toBe(false)
  })

  it('manda el período como fechas y el texto vacío como null', async () => {
    const rpc = vi.fn().mockResolvedValue(respuesta([], 0))
    await traerActividadParaExportar({ rpc } as never, { ...FILTROS_ACTIVIDAD_INICIALES, periodo: '7dias', texto: '   ' })
    const args = rpc.mock.calls[0][1]
    expect(args.p_desde).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(args.p_hasta).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(args.p_texto).toBeNull()
  })

  it('no sigue pidiendo pasado el tope y avisa que se recortó (CA-AUD-03-3)', async () => {
    const lote = Array.from({ length: LOTE_EXPORTACION_ACTIVIDAD }, () => fila())
    const rpc = vi.fn().mockResolvedValue(respuesta(lote, 80_000))
    const resultado = await traerActividadParaExportar({ rpc } as never, FILTROS_ACTIVIDAD_INICIALES)
    expect(resultado.filas).toHaveLength(TOPE_FILAS_ACTIVIDAD)
    expect(rpc).toHaveBeenCalledTimes(TOPE_FILAS_ACTIVIDAD / LOTE_EXPORTACION_ACTIVIDAD)
    expect(resultado.total).toBe(80_000)
    expect(resultado.recortado).toBe(true)
  })

  it('corta si la base no entrega filas, aunque falten según el total', async () => {
    const rpc = vi.fn().mockResolvedValue(respuesta([], 10))
    const resultado = await traerActividadParaExportar({ rpc } as never, FILTROS_ACTIVIDAD_INICIALES)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(resultado.filas).toHaveLength(0)
  })

  it('propaga el error de la base sin devolver un resultado parcial', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom', code: '42501' } })
    await expect(traerActividadParaExportar({ rpc } as never, FILTROS_ACTIVIDAD_INICIALES)).rejects.toMatchObject({ code: '42501' })
  })
})
