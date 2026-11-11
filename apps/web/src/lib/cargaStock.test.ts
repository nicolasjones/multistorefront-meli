// @vitest-environment node
import { strFromU8, unzipSync } from 'fflate'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import {
  ErrorPlanilla, MAXIMO_FILAS_CARGA, aplicarCarga, armarPlantilla, contarCambios, contarErrores, filasParaRpc,
  leerPlanilla, mensajeDeErrorCarga, normalizarHoja, rotularDiferencia, validarCarga, type FilaValidada,
} from './cargaStock'

const ENCABEZADO = ['sku', 'cantidad', 'motivo']

describe('normalizarHoja (FR-004)', () => {
  it('recorta el SKU, lee numéricos como texto y numera por fila de la hoja', () => {
    const { filas } = normalizarHoja([ENCABEZADO, ['  ABC-1 ', 12, 'Conteo'], [1234, '7', null]])
    expect(filas).toEqual([
      { fila: 2, sku: 'ABC-1', cantidad: '12', motivo: 'Conteo' },
      { fila: 3, sku: '1234', cantidad: '7', motivo: null },
    ])
  })

  it('ignora las filas en blanco sin correr la numeración', () => {
    const { filas } = normalizarHoja([ENCABEZADO, [null, null, null], ['A', 1, null], ['  ', '', ''], ['B', 2, null]])
    expect(filas.map((f) => [f.fila, f.sku])).toEqual([[3, 'A'], [5, 'B']])
  })

  it('los encabezados no distinguen mayúsculas y la columna motivo es opcional', () => {
    const { filas } = normalizarHoja([['SKU', ' Cantidad '], ['A', 3]])
    expect(filas).toEqual([{ fila: 2, sku: 'A', cantidad: '3', motivo: null }])
  })

  it('conserva las filas con SKU o cantidad vacíos para que el servidor las marque', () => {
    const { filas } = normalizarHoja([ENCABEZADO, ['', 5, null], ['X', '', null]])
    expect(filas).toHaveLength(2)
  })

  it('rechaza una hoja vacía', () => {
    expect(() => normalizarHoja([])).toThrow(ErrorPlanilla)
    expect(() => normalizarHoja([])).toThrow('La planilla está vacía.')
  })

  it('rechaza una hoja sin filas con datos', () => {
    expect(() => normalizarHoja([ENCABEZADO, [null, null, null]])).toThrow('La planilla no tiene filas con datos.')
  })

  it('rechaza una hoja sin encabezado sku o cantidad', () => {
    expect(() => normalizarHoja([['codigo', 'cantidad'], ['A', 1]])).toThrow('encabezados «sku» y «cantidad»')
    expect(() => normalizarHoja([['sku', 'unidades'], ['A', 1]])).toThrow('encabezados «sku» y «cantidad»')
  })

  it('acepta exactamente el tope y rechaza una fila más', () => {
    const filas = (n: number) => Array.from({ length: n }, (_, i) => [`S${i}`, 1, null])
    expect(normalizarHoja([ENCABEZADO, ...filas(MAXIMO_FILAS_CARGA)]).filas).toHaveLength(MAXIMO_FILAS_CARGA)
    expect(() => normalizarHoja([ENCABEZADO, ...filas(MAXIMO_FILAS_CARGA + 1)])).toThrow('más de 2.000 filas')
  })
})

async function xlsxDe(filas: (string | number | null)[][], nombre = 'stock.xlsx') {
  const { default: escribirXlsx } = await import('write-excel-file/browser')
  const datos = filas.map((fila) => fila.map((valor) => {
    if (valor === null) return null
    return typeof valor === 'number' ? { type: Number, value: valor } : { type: String, value: valor }
  }))
  const blob = await escribirXlsx(datos).toBlob()
  return new File([blob], nombre)
}

describe('leerPlanilla (FR-004)', () => {
  it('lee la primera hoja de un .xlsx real', async () => {
    const archivo = await xlsxDe([ENCABEZADO, ['ABC-1', 12, 'Conteo'], [1234, 7, null]])
    const { filas } = await leerPlanilla(archivo)
    expect(filas).toEqual([
      { fila: 2, sku: 'ABC-1', cantidad: '12', motivo: 'Conteo' },
      { fila: 3, sku: '1234', cantidad: '7', motivo: null },
    ])
  })

  it('rechaza un archivo que no es .xlsx por su extensión, sin leerlo', async () => {
    await expect(leerPlanilla(new File(['sku,cantidad'], 'stock.csv'))).rejects.toThrow('debe ser una planilla Excel (.xlsx)')
  })

  it('rechaza un .xlsx de más de 5 MB antes de leerlo', async () => {
    const grande = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'stock.xlsx')
    await expect(leerPlanilla(grande)).rejects.toThrow('pesa más de 5 MB')
  })

  it('rechaza un .xlsx dañado con un mensaje claro', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(leerPlanilla(new File(['no soy un zip'], 'stock.xlsx'))).rejects.toThrow('No pudimos leer el archivo')
  })

  it('rechaza un .xlsx sin encabezados sku/cantidad', async () => {
    await expect(leerPlanilla(await xlsxDe([['a', 'b'], ['x', 1]]))).rejects.toThrow('encabezados «sku» y «cantidad»')
  })
})

describe('armarPlantilla (FR-002)', () => {
  it('genera un .xlsx con las columnas sku, cantidad y motivo', async () => {
    const archivos = unzipSync(new Uint8Array(await (await armarPlantilla()).arrayBuffer()))
    const ruta = Object.keys(archivos).find((r) => r.endsWith('sharedStrings.xml'))
    const textos = ruta ? strFromU8(archivos[ruta]) : ''
    for (const columna of ['sku', 'cantidad', 'motivo']) expect(textos).toContain(`>${columna}<`)
  })
})

describe('RPC de la carga', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('validarCarga envía depósito y filas tal como salen de la planilla', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ fila: 2, estado: 'ajuste' }], error: null })
    const filas = [{ fila: 2, sku: 'A', cantidad: '3', motivo: null }]
    expect(await validarCarga('dep-1', filas)).toEqual([{ fila: 2, estado: 'ajuste' }])
    expect(mocks.rpc).toHaveBeenCalledWith('validar_carga_stock', { p_deposito: 'dep-1', p_filas: filasParaRpc(filas) })
  })

  it('aplicarCarga envía la clave de idempotencia y devuelve el resultado', async () => {
    mocks.rpc.mockResolvedValue({ data: { aplicadas: 1, omitidas: 0, repetido: false, detalle: [] }, error: null })
    const resultado = await aplicarCarga('dep-1', [{ fila: 2, sku: 'A', cantidad: '3', motivo: 'x' }], 'clave-1')
    expect(resultado.aplicadas).toBe(1)
    expect(mocks.rpc).toHaveBeenCalledWith('aplicar_carga_inicial_stock', {
      p_deposito: 'dep-1', p_filas: [{ fila: 2, sku: 'A', cantidad: '3', motivo: 'x' }], p_clave: 'clave-1',
    })
  })

  it('propaga el error de la base', async () => {
    const error = { code: '42501', message: 'Tu rol no puede cargar stock por planilla' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(aplicarCarga('dep-1', [], 'c')).rejects.toBe(error)
  })
})

describe('rotulado', () => {
  const fila = (estado: FilaValidada['estado']): FilaValidada => ({
    fila: 2, sku: 'A', producto: null, stock_actual: null, en_planilla: null, quedara: null, diferencia: null, estado, mensaje: '',
  })

  it('cuenta cambios y errores', () => {
    const filas = [fila('ajuste'), fila('ajuste'), fila('sin_cambios'), fila('error')]
    expect(contarCambios(filas)).toBe(2)
    expect(contarErrores(filas)).toBe(1)
  })

  it('rotula la diferencia con signo', () => {
    expect(rotularDiferencia(3)).toBe('+3')
    expect(rotularDiferencia(-2)).toBe('-2')
    expect(rotularDiferencia(0)).toBe('0')
    expect(rotularDiferencia(null)).toBe('—')
  })

  it('traduce los errores de la base a mensajes claros', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(mensajeDeErrorCarga({ code: '42501' }, 'x')).toContain('No tenés permiso')
    expect(mensajeDeErrorCarga({ code: '22023', message: 'La planilla admite hasta 2000 filas' }, 'x')).toBe('La planilla admite hasta 2000 filas')
    expect(mensajeDeErrorCarga(new Error('boom'), 'por defecto')).toBe('por defecto')
  })
})
