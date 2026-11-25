// @vitest-environment node
import { unzipSync, strFromU8 } from 'fflate'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { ErrorExportacion, ExportacionCancelada } from './exportarClientes'
import {
  exportarProveedores, nombreArchivoExportacionProveedores, TAMANO_LOTE_EXPORTACION_PROVEEDORES,
  type FilaExportacionProveedor,
} from './exportarProveedores'

const fila = (n: number, extra: Partial<FilaExportacionProveedor> = {}, total = 3): FilaExportacionProveedor => ({
  id: `id-${n}`, numero: n, razon_social: `Proveedor ${n}`, cuit: '20123456786', compra_para: '', correo: null, telefono: null, activo: true, total, ...extra,
})

const filtros = { texto: ' norte ', estado: 'activos' as const, empresaId: null }

async function leerXlsx(blob: Blob) {
  const archivos = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  const texto = (sufijo: string) => {
    const ruta = Object.keys(archivos).find((r) => r.endsWith(sufijo))
    return ruta ? strFromU8(archivos[ruta]) : ''
  }
  return { hoja: texto('worksheets/sheet1.xml'), textos: texto('sharedStrings.xml'), libro: texto('workbook.xml') }
}

describe('exportarProveedores', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('pide el lote con los filtros del listado y arma un .xlsx con N.º, CUIT con guiones y estado', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [fila(1, { compra_para: 'Mundo JC, San Javucho' }), fila(2, { activo: false, correo: 'a@uno.example.com' }), fila(3)], error: null,
    })
    const progresos: unknown[] = []
    const blob = await exportarProveedores({ ...filtros, empresaId: 'e-1' }, { alProgresar: (p) => progresos.push(p) })

    expect(mocks.rpc).toHaveBeenCalledWith('exportar_proveedores', {
      p_texto: 'norte', p_estado: 'activos', p_empresa_id: 'e-1', p_despues_de: null, p_limite: TAMANO_LOTE_EXPORTACION_PROVEEDORES,
    })
    expect(progresos).toEqual([{ descargados: 3, total: 3 }])
    const { hoja, textos, libro } = await leerXlsx(blob)
    expect(libro).toContain('Proveedores')
    for (const esperado of ['N.º', 'Razón social', 'Compra para', 'Proveedor 1', '20-12345678-6', 'Mundo JC, San Javucho', 'Activo', 'Inactivo', 'a@uno.example.com']) {
      expect(textos).toContain(esperado)
    }
    expect((hoja.match(/<row /g) ?? []).length).toBe(4)
  })

  it('recorre varios lotes con el último id como cursor', async () => {
    const lleno = Array.from({ length: TAMANO_LOTE_EXPORTACION_PROVEEDORES }, (_, i) => fila(i, {}, TAMANO_LOTE_EXPORTACION_PROVEEDORES + 1))
    mocks.rpc
      .mockResolvedValueOnce({ data: lleno, error: null })
      .mockResolvedValueOnce({ data: [fila(5000, {}, TAMANO_LOTE_EXPORTACION_PROVEEDORES + 1)], error: null })
    const progresos: { descargados: number }[] = []
    await exportarProveedores(filtros, { alProgresar: (p) => progresos.push(p) })

    expect(mocks.rpc).toHaveBeenCalledTimes(2)
    expect(mocks.rpc.mock.calls[1][1].p_despues_de).toBe(`id-${TAMANO_LOTE_EXPORTACION_PROVEEDORES - 1}`)
    expect(progresos.map((p) => p.descargados)).toEqual([TAMANO_LOTE_EXPORTACION_PROVEEDORES, TAMANO_LOTE_EXPORTACION_PROVEEDORES + 1])
  })

  it('neutraliza las fórmulas y escribe todas las celdas como texto', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [fila(1, { razon_social: '=HYPERLINK("http://x","clic")', correo: '@evil', telefono: '+5491122' })], error: null })
    const { hoja, textos } = await leerXlsx(await exportarProveedores(filtros))

    expect(hoja).not.toMatch(/<f[ >]/)
    expect(textos).toContain(`'=HYPERLINK`)
    expect(textos).toContain(`'@evil`)
    expect(textos).toContain(`'+5491122`)
    expect(hoja).not.toMatch(/<c [^>]*t="n"/)
  })

  it('los errores del servidor se informan con un mensaje útil', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '54000', message: 'x' } })
    await expect(exportarProveedores(filtros)).rejects.toThrow(/Afiná la búsqueda/)
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'x' } })
    await expect(exportarProveedores(filtros)).rejects.toThrow(/permiso/)
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '40001', message: 'x' } })
    await expect(exportarProveedores(filtros)).rejects.toThrow(/cambiaron/)
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'se cayó' } })
    await expect(exportarProveedores(filtros)).rejects.toThrow('No pudimos exportar los proveedores. Intentá de nuevo.')
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } })
    await expect(exportarProveedores(filtros)).rejects.toBeInstanceOf(ErrorExportacion)
  })

  it('se puede cancelar entre lotes', async () => {
    const abort = new AbortController()
    mocks.rpc.mockImplementationOnce(async () => {
      abort.abort()
      return { data: Array.from({ length: TAMANO_LOTE_EXPORTACION_PROVEEDORES }, (_, i) => fila(i)), error: null }
    })
    await expect(exportarProveedores(filtros, { signal: abort.signal })).rejects.toBeInstanceOf(ExportacionCancelada)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it('el archivo se llama proveedores-AAAA-MM-DD.xlsx', () => {
    expect(nombreArchivoExportacionProveedores()).toMatch(/^proveedores-\d{4}-\d{2}-\d{2}\.xlsx$/)
  })
})
