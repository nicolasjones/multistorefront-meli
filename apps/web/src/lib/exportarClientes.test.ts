// @vitest-environment node
import { unzipSync, strFromU8 } from 'fflate'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), fallarXlsx: false, alEscribir: undefined as undefined | (() => void) }))
vi.mock('write-excel-file/browser', async (importOriginal) => {
  const real = await importOriginal<typeof import('write-excel-file/browser')>()
  return {
    ...real,
    default: (...args: Parameters<typeof real.default>) => {
      if (mocks.fallarXlsx) throw new Error('Failed to fetch dynamically imported module')
      mocks.alEscribir?.()
      return real.default(...args)
    },
  }
})
vi.mock('./supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import {
  ErrorExportacion, ExportacionCancelada, exportarClientes, nombreArchivoExportacion, neutralizarFormula,
  TAMANO_LOTE_EXPORTACION, type FilaExportacion,
} from './exportarClientes'

const fila = (n: number, extra: Partial<FilaExportacion> = {}, total = 3): FilaExportacion => ({
  id: `id-${n}`, numero: n, nombre: `Cliente ${n}`, documento: null, tipo: 'minorista', correo: null, telefono: null, celular: null,
  direccion: null, codigo_postal: null, localidad: null, provincia: null, archivado_en: null, total, ...extra,
})

const filtros = { texto: ' norte ', tipo: null, archivados: false }

async function leerXlsx(blob: Blob) {
  const archivos = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  const texto = (sufijo: string) => {
    const ruta = Object.keys(archivos).find((r) => r.endsWith(sufijo))
    return ruta ? strFromU8(archivos[ruta]) : ''
  }
  return { hoja: texto('worksheets/sheet1.xml'), textos: texto('sharedStrings.xml'), libro: texto('workbook.xml') }
}

describe('neutralizarFormula', () => {
  it.each(['=cmd|calc', '+1', '-2', '@SUM(A1)', '\t=x', '\r=x'])('antepone apóstrofo a «%s»', (valor) => {
    expect(neutralizarFormula(valor)).toBe(`'${valor}`)
  })
  it('no toca los textos normales', () => {
    expect(neutralizarFormula('Norte S.A.')).toBe('Norte S.A.')
    expect(neutralizarFormula('a=b')).toBe('a=b')
  })
})

describe('exportarClientes', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('pide lotes por keyset con los filtros y arma un .xlsx válido y reabrible', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [fila(1), fila(2, { tipo: 'mayorista', archivado_en: '2026-01-01' }), fila(3)], error: null })
    const progresos: unknown[] = []
    const blob = await exportarClientes(filtros, { alProgresar: (p) => progresos.push(p) })

    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('exportar_clientes', {
      p_texto: 'norte', p_tipo: null, p_archivados: false, p_despues_de: null, p_limite: TAMANO_LOTE_EXPORTACION,
    })
    expect(progresos).toEqual([{ descargados: 3, total: 3 }])
    const { hoja, textos, libro } = await leerXlsx(blob)
    expect(libro).toContain('Clientes')
    for (const esperado of ['Nombre o razón social', 'Cliente 1', 'Cliente 3', 'Mayorista', 'Archivado', 'Activo']) expect(textos).toContain(esperado)
    expect((hoja.match(/<row /g) ?? []).length).toBe(4)
  })

  it('recorre varios lotes: el cursor es el último id del lote y se reporta el progreso', async () => {
    const lleno = Array.from({ length: TAMANO_LOTE_EXPORTACION }, (_, i) => fila(i, {}, TAMANO_LOTE_EXPORTACION + 1))
    mocks.rpc
      .mockResolvedValueOnce({ data: lleno, error: null })
      .mockResolvedValueOnce({ data: [fila(5000, {}, TAMANO_LOTE_EXPORTACION + 1)], error: null })
    const progresos: { descargados: number }[] = []
    await exportarClientes(filtros, { alProgresar: (p) => progresos.push(p) })

    expect(mocks.rpc).toHaveBeenCalledTimes(2)
    expect(mocks.rpc.mock.calls[1][1].p_despues_de).toBe(`id-${TAMANO_LOTE_EXPORTACION - 1}`)
    expect(progresos.map((p) => p.descargados)).toEqual([TAMANO_LOTE_EXPORTACION, TAMANO_LOTE_EXPORTACION + 1])
  })

  it('neutraliza las fórmulas y escribe todas las celdas como texto, nunca como fórmula', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [fila(1, { nombre: '=HYPERLINK("http://x","clic")', correo: '@evil', telefono: '+5491122', documento: '-1' })], error: null })
    const { hoja, textos } = await leerXlsx(await exportarClientes(filtros))

    expect(hoja).not.toMatch(/<f[ >]/)
    expect(textos).toContain(`'=HYPERLINK`)
    expect(textos).toContain(`'@evil`)
    expect(textos).toContain(`'+5491122`)
    expect(textos).not.toMatch(/>=HYPERLINK/)
    // El número de cliente también va como texto, no como número.
    expect(hoja).not.toMatch(/<c [^>]*t="n"/)
  })

  it('un error del servidor se informa con mensaje útil y el de tope pide afinar la búsqueda', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '54000', message: 'x' } })
    await expect(exportarClientes(filtros)).rejects.toThrow(/Afiná la búsqueda/)
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'x' } })
    await expect(exportarClientes(filtros)).rejects.toThrow(/permiso/)
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'se cayó' } })
    await expect(exportarClientes(filtros)).rejects.toThrow('No pudimos exportar los clientes. Intentá de nuevo.')
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '40001', message: 'x' } })
    await expect(exportarClientes(filtros)).rejects.toThrow(/cambiaron/)
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } })
    await expect(exportarClientes(filtros)).rejects.toBeInstanceOf(ErrorExportacion)
  })

  it('se puede cancelar entre lotes', async () => {
    const abort = new AbortController()
    mocks.rpc.mockImplementationOnce(async () => {
      abort.abort()
      return { data: Array.from({ length: TAMANO_LOTE_EXPORTACION }, (_, i) => fila(i)), error: null }
    })
    await expect(exportarClientes(filtros, { signal: abort.signal })).rejects.toBeInstanceOf(ExportacionCancelada)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it('un fallo al armar el .xlsx llega como ErrorExportacion en castellano', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [fila(1)], error: null })
    mocks.fallarXlsx = true
    try {
      await expect(exportarClientes(filtros)).rejects.toMatchObject({ name: 'ErrorExportacion', message: 'No pudimos armar el archivo. Intentá de nuevo.' })
    } finally {
      mocks.fallarXlsx = false
    }
  })

  it('cancelar mientras se arma el archivo no termina en descarga', async () => {
    const abort = new AbortController()
    mocks.rpc.mockResolvedValueOnce({ data: [fila(1)], error: null })
    mocks.alEscribir = () => abort.abort()
    try {
      await expect(exportarClientes(filtros, { signal: abort.signal })).rejects.toBeInstanceOf(ExportacionCancelada)
    } finally {
      mocks.alEscribir = undefined
    }
  })

  it('nombra el archivo con la fecha', () => {
    expect(nombreArchivoExportacion(new Date('2026-10-16T12:00:00Z'))).toBe('clientes-2026-10-16.xlsx')
  })
})
