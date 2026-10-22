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
import { exportarRanking, nombreArchivoRanking, TOPE_FILAS_RANKING } from './exportarRanking'

const parametros = { desde: '2026-10-01', hasta: '2026-10-15', tipo: null, incluirConsumidorFinal: false, conIva: false, empresaId: null }

const fila = (n: number, extra: Record<string, unknown> = {}, total = 3) => ({
  posicion: n, cliente_id: `c-${n}`, numero: n, nombre: `Cliente ${n}`, tipo: 'minorista',
  comprobantes: 2, facturado: '1000.50', participacion: '25.5', total_filas: total, ...extra,
})

async function leerXlsx(blob: Blob) {
  const archivos = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  const texto = (sufijo: string) => {
    const ruta = Object.keys(archivos).find((r) => r.endsWith(sufijo))
    return ruta ? strFromU8(archivos[ruta]) : ''
  }
  return { hoja: texto('worksheets/sheet1.xml'), textos: texto('sharedStrings.xml'), libro: texto('workbook.xml') }
}

describe('exportarRanking', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('llama a ranking_clientes con los filtros vigentes y arma un .xlsx con las mismas filas y el total', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [fila(1), fila(2, { tipo: 'mayorista', nombre: 'Ñandú Ávila' }), fila(3)], error: null })
    const progresos: unknown[] = []
    const blob = await exportarRanking({ ...parametros, tipo: 'mayorista', conIva: true }, { alProgresar: (p) => progresos.push(p) })

    expect(mocks.rpc).toHaveBeenCalledWith('ranking_clientes', {
      p_desde: '2026-10-01', p_hasta: '2026-10-15', p_tipo: 'mayorista', p_incluir_consumidor_final: false, p_con_iva: true,
      p_pagina: 1, p_tamano: TAMANO_LOTE_EXPORTACION, p_empresa_id: null,
    })
    expect(progresos).toEqual([{ descargados: 3, total: 3 }])
    const { hoja, textos, libro } = await leerXlsx(blob)
    expect(libro).toContain('Ranking de clientes')
    for (const esperado of ['Cliente', 'Participación', 'Facturado (con IVA)', 'Cliente 1', 'Ñandú Ávila', 'Mayorista', '2026-10-01 al 2026-10-15', 'Facturado con IVA', 'Total facturado']) {
      expect(textos).toContain(esperado)
    }
    // Encabezados + 3 filas + blanco + 3 filas de contexto.
    expect((hoja.match(/<row /g) ?? []).length).toBe(8)
    // Importes y porcentaje numéricos: 3 × 1000.50 = 3001.5 y 25.5 % = 0.255.
    expect(hoja).toContain('3001.5')
    expect(hoja).toContain('0.255')
  })

  it('pide página por página hasta cubrir total_filas y reporta el progreso', async () => {
    const total = TAMANO_LOTE_EXPORTACION + 1
    mocks.rpc
      .mockResolvedValueOnce({ data: Array.from({ length: TAMANO_LOTE_EXPORTACION }, (_, i) => fila(i + 1, {}, total)), error: null })
      .mockResolvedValueOnce({ data: [fila(total, {}, total)], error: null })
    const progresos: { descargados: number }[] = []
    await exportarRanking(parametros, { alProgresar: (p) => progresos.push(p) })

    expect(mocks.rpc).toHaveBeenCalledTimes(2)
    expect(mocks.rpc.mock.calls[1][1].p_pagina).toBe(2)
    expect(progresos.map((p) => p.descargados)).toEqual([TAMANO_LOTE_EXPORTACION, total])
  })

  it('respeta el tope: más de 100.000 clientes no se descarga', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [fila(1, {}, TOPE_FILAS_RANKING + 1)], error: null })
    await expect(exportarRanking(parametros)).rejects.toThrow(/Acotá el período/)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it('neutraliza las fórmulas en el texto y no escribe fórmulas', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [fila(1, { nombre: '=HYPERLINK("http://x","clic")' }), fila(2, { nombre: '@evil' }), fila(3, { nombre: '+5491122' })], error: null })
    const { hoja, textos } = await leerXlsx(await exportarRanking(parametros))

    expect(hoja).not.toMatch(/<f[ >]/)
    expect(textos).toContain(`'=HYPERLINK`)
    expect(textos).toContain(`'@evil`)
    expect(textos).toContain(`'+5491122`)
    expect(textos).not.toMatch(/>=HYPERLINK/)
  })

  it('un error del servidor se informa en castellano', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'x' } })
    await expect(exportarRanking(parametros)).rejects.toThrow(/permiso/)
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'se cayó' } })
    await expect(exportarRanking(parametros)).rejects.toThrow('No pudimos exportar el ranking. Intentá de nuevo.')
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } })
    await expect(exportarRanking(parametros)).rejects.toBeInstanceOf(ErrorExportacion)
  })

  it('se puede cancelar entre lotes', async () => {
    const abort = new AbortController()
    mocks.rpc.mockImplementationOnce(async () => {
      abort.abort()
      return { data: Array.from({ length: TAMANO_LOTE_EXPORTACION }, (_, i) => fila(i + 1, {}, 5000)), error: null }
    })
    await expect(exportarRanking(parametros, { signal: abort.signal })).rejects.toBeInstanceOf(ExportacionCancelada)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it('un fallo al armar el .xlsx llega como ErrorExportacion en castellano', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [fila(1, {}, 1)], error: null })
    mocks.fallarXlsx = true
    try {
      await expect(exportarRanking(parametros)).rejects.toMatchObject({ name: 'ErrorExportacion', message: 'No pudimos armar el archivo. Intentá de nuevo.' })
    } finally {
      mocks.fallarXlsx = false
    }
  })

  it('nombra el archivo con el período', () => {
    expect(nombreArchivoRanking(parametros)).toBe('ranking-clientes-2026-10-01_2026-10-15.xlsx')
  })
})
