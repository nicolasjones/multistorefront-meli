// @vitest-environment node
import { unzipSync, strFromU8 } from 'fflate'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), fallarXlsx: false }))
vi.mock('write-excel-file/browser', async (importOriginal) => {
  const real = await importOriginal<typeof import('write-excel-file/browser')>()
  return {
    ...real,
    default: (...args: Parameters<typeof real.default>) => {
      if (mocks.fallarXlsx) throw new Error('Failed to fetch dynamically imported module')
      return real.default(...args)
    },
  }
})
vi.mock('./supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { ErrorExportacion, ExportacionCancelada, TAMANO_LOTE_EXPORTACION } from './exportarClientes'
import {
  exportarRankingVentas, nombreArchivoRankingVentas, TOPE_FILAS_RANKING_VENTAS,
} from './exportarRankingVentas'

const parametros = { desde: '2026-10-01', hasta: '2026-10-15', incluirConsumidorFinal: false, empresaId: null }

const fila = (n: number, extra: Record<string, unknown> = {}, total = 3) => ({
  posicion: n,
  cliente_id: `c-${n}`,
  numero: n,
  nombre: `Cliente ${n}`,
  tipo: 'minorista',
  comprobantes: 2,
  facturado: '1000.50',
  participacion: '25.5',
  ultimo_comprador: '2026-10-05',
  total_filas: total,
  ...extra,
})

async function leerXlsx(blob: Blob) {
  const archivos = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  const texto = (sufijo: string) => {
    const ruta = Object.keys(archivos).find((r) => r.endsWith(sufijo))
    return ruta ? strFromU8(archivos[ruta]) : ''
  }
  return { hoja: texto('worksheets/sheet1.xml'), textos: texto('sharedStrings.xml'), libro: texto('workbook.xml') }
}

describe('exportarRankingVentas (F-VTA-23, FR-009, SC-004)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lee el ranking con los filtros vigentes y arma un .xlsx con las mismas filas y el total', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [fila(1), fila(2, { tipo: 'mayorista', nombre: 'Ñandú Ávila' }), fila(3)], error: null })
    const progresos: unknown[] = []
    const blob = await exportarRankingVentas({ ...parametros, incluirConsumidorFinal: true, empresaId: 'e-1' }, { alProgresar: (p) => progresos.push(p) })

    // La RPC lee la misma vista que el tablero (FR-009): los filtros de la pantalla viajan tal cual.
    expect(mocks.rpc).toHaveBeenCalledWith('leer_ranking_ventas', {
      p_desde: '2026-10-01',
      p_hasta: '2026-10-15',
      p_incluir_consumidor_final: true,
      p_empresa_id: 'e-1',
      p_pagina: 1,
      p_tamano: TAMANO_LOTE_EXPORTACION,
    })
    expect(progresos).toEqual([{ descargados: 3, total: 3 }])

    const { hoja, textos, libro } = await leerXlsx(blob)
    expect(libro).toContain('Ranking de clientes')
    // Las columnas son las de la tabla de la pantalla.
    for (const esperado of ['Cliente', 'Nº', 'Tipo', '#', 'Comprobantes', 'Facturado', 'Participación', 'Último comprador']) {
      expect(textos).toContain(esperado)
    }
    // Las filas son las que devolvió la base (misma fuente que el tablero) y el total es su suma.
    for (const esperado of ['Cliente 1', 'Ñandú Ávila', 'Mayorista', '05/10/2026']) {
      expect(textos).toContain(esperado)
    }
    // Encabezados + 3 filas + blanco + 4 filas de contexto (período, consumidor final, clientes, total).
    expect((hoja.match(/<row /g) ?? []).length).toBe(9)
    // 3 × 1000.50 = 3001.50 de facturado y 25.5 % = 0.255 de participación.
    expect(hoja).toContain('3001.5')
    expect(hoja).toContain('0.255')
  })

  it('pide página por página hasta cubrir total_filas y reporta el progreso', async () => {
    const total = TAMANO_LOTE_EXPORTACION + 1
    mocks.rpc
      .mockResolvedValueOnce({ data: Array.from({ length: TAMANO_LOTE_EXPORTACION }, (_, i) => fila(i + 1, {}, total)), error: null })
      .mockResolvedValueOnce({ data: [fila(total, {}, total)], error: null })
    const progresos: { descargados: number }[] = []
    await exportarRankingVentas(parametros, { alProgresar: (p) => progresos.push(p) })

    expect(mocks.rpc).toHaveBeenCalledTimes(2)
    expect(mocks.rpc.mock.calls[1][1].p_pagina).toBe(2)
    expect(progresos.map((p) => p.descargados)).toEqual([TAMANO_LOTE_EXPORTACION, total])
  })

  it('respeta el tope: más de 100.000 clientes no se descarga', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [fila(1, {}, TOPE_FILAS_RANKING_VENTAS + 1)], error: null })
    await expect(exportarRankingVentas(parametros)).rejects.toThrow(/Acotá el período/)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it('con el ranking vacío avisa que no hay clientes (no arma un archivo vacío)', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null })
    await expect(exportarRankingVentas(parametros)).rejects.toMatchObject({ codigo: 'VACIO' })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it('neutraliza las fórmulas en el texto y no escribe fórmulas', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [
        fila(1, { nombre: '=HYPERLINK("http://x","clic")' }),
        fila(2, { nombre: '@evil' }),
        fila(3, { nombre: '+5491122' }),
      ],
      error: null,
    })
    const { hoja, textos } = await leerXlsx(await exportarRankingVentas(parametros))

    expect(hoja).not.toMatch(/<f[ >]/)
    expect(textos).toContain(`'=HYPERLINK`)
    expect(textos).toContain(`'@evil`)
    expect(textos).toContain(`'+5491122`)
    expect(textos).not.toMatch(/>=HYPERLINK/)
  })

  it('el servidor rechaza la exportación sin permiso de reportes (SC-005)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Tu rol no puede ver los reportes de ventas' } })
    await expect(exportarRankingVentas(parametros)).rejects.toThrow(/permiso/)
    await expect(exportarRankingVentas(parametros)).rejects.toBeInstanceOf(ErrorExportacion)
  })

  it('un error del servidor se informa en castellano', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'El rango de fechas no es válido' } })
    await expect(exportarRankingVentas(parametros)).rejects.toThrow(/filtros del período/)
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'se cayó' } })
    await expect(exportarRankingVentas(parametros)).rejects.toThrow('No pudimos exportar el ranking. Intentá de nuevo.')
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } })
    await expect(exportarRankingVentas(parametros)).rejects.toBeInstanceOf(ErrorExportacion)
  })

  it('se puede cancelar entre lotes', async () => {
    const abort = new AbortController()
    mocks.rpc.mockImplementationOnce(async () => {
      abort.abort()
      return { data: Array.from({ length: TAMANO_LOTE_EXPORTACION }, (_, i) => fila(i + 1, {}, 5000)), error: null }
    })
    await expect(exportarRankingVentas(parametros, { signal: abort.signal })).rejects.toBeInstanceOf(ExportacionCancelada)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it('un fallo al armar el .xlsx llega como ErrorExportacion en castellano', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [fila(1, {}, 1)], error: null })
    mocks.fallarXlsx = true
    try {
      await expect(exportarRankingVentas(parametros)).rejects.toMatchObject({ name: 'ErrorExportacion', message: 'No pudimos armar el archivo. Intentá de nuevo.' })
    } finally {
      mocks.fallarXlsx = false
    }
  })

  it('nombra el archivo con el período', () => {
    expect(nombreArchivoRankingVentas(parametros)).toBe('ranking-clientes-ventas-2026-10-01_2026-10-15.xlsx')
  })
})
