import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Hallazgo S-3 de la revisión final: el sondeo del tope pedía `pedirLote(tope, 1)`; en la pantalla «Movimientos por
// producto» eso es la página 100001 de tamaño 1, que la RPC acota a 100000 y devuelve la fila 100.000 aunque no haya
// más. La regla ahora: el hook SIEMPRE pide lotes de `tamanoLote` (páginas exactas), y el tope se reduce a 300 filas.
const mocks = vi.hoisted(() => ({ descargar: vi.fn() }))
vi.mock('../lib/exportarCsv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/exportarCsv')>()), TOPE_FILAS_EXPORTACION: 300, descargarCsv: mocks.descargar }))

import { useExportarCsv } from './useExportarCsv'

type Fila = { id: string; valor: number }
const columnas = [{ encabezado: 'Id', valor: (f: Fila) => f.id }]
const dataset = (cantidad: number): Fila[] => Array.from({ length: cantidad }, (_, i) => ({ id: `f-${i + 1}`, valor: i }))

function preparar(filas: Fila[], opciones: { clave?: (fila: Fila) => string } = {}) {
  const pedidos: Array<[number, number]> = []
  const pedirLote = vi.fn(async (desde: number, limite: number) => {
    pedidos.push([desde, limite])
    // Servidor simulado: un lote es una página exacta de tamaño `limite` (nunca se pide una más chica que el lote).
    if (limite !== 100) throw new Error(`se pidió un lote de ${limite}: el hook debe pedir siempre lotes de 100`)
    return filas.slice(desde, desde + limite)
  })
  const hook = renderHook(() => useExportarCsv<Fila>({ columnas, nombreArchivo: () => 'x.csv', tamanoLote: 100, pedirLote, ...opciones }))
  return { hook, pedidos }
}

beforeEach(() => { mocks.descargar.mockReset() })

describe('useExportarCsv · tope de filas', () => {
  it('con exactamente el tope exporta todo, sin aviso y sin pedir lotes más chicos que el lote', async () => {
    const { hook, pedidos } = preparar(dataset(300))
    await act(async () => { await hook.result.current.exportar() })
    await waitFor(() => expect(mocks.descargar).toHaveBeenCalledTimes(1))
    expect(hook.result.current.mensaje).toBeNull()
    expect(pedidos.every(([, limite]) => limite === 100)).toBe(true)
    expect(pedidos.map(([desde]) => desde)).toEqual([0, 100, 200, 300])
  })

  it('con una fila más que el tope exporta el tope y avisa el truncado', async () => {
    const { hook } = preparar(dataset(301))
    await act(async () => { await hook.result.current.exportar() })
    await waitFor(() => expect(mocks.descargar).toHaveBeenCalledTimes(1))
    expect(hook.result.current.mensaje).toMatchObject({ tipo: 'aviso' })
    expect(hook.result.current.mensaje?.texto).toContain('300')
    const [contenido] = mocks.descargar.mock.calls[0] as [string]
    expect(contenido.replace(/^﻿/, '').split('\r\n').filter((l) => l !== '')).toHaveLength(301)
  })

  it('con menos filas que el tope no avisa', async () => {
    const { hook } = preparar(dataset(250))
    await act(async () => { await hook.result.current.exportar() })
    await waitFor(() => expect(mocks.descargar).toHaveBeenCalledTimes(1))
    expect(hook.result.current.mensaje).toBeNull()
  })
})

describe('useExportarCsv · filas repetidas entre lotes', () => {
  it('con `clave` una fila repetida se exporta una sola vez y el desplazamiento sigue las filas PEDIDAS (no las exportadas)', async () => {
    const base = dataset(250)
    // El lote 2 empieza repitiendo el último producto del lote 1 (corrimiento de offset): 251 filas pedidas, 250 únicas.
    const conRepetida = [...base.slice(0, 100), base[99], ...base.slice(100)]
    const { hook, pedidos } = preparar(conRepetida, { clave: (fila) => fila.id })
    await act(async () => { await hook.result.current.exportar() })
    await waitFor(() => expect(mocks.descargar).toHaveBeenCalledTimes(1))
    const [contenido] = mocks.descargar.mock.calls[0] as [string]
    const ids = contenido.replace(/^﻿/, '').split('\r\n').filter((l) => l !== '').slice(1)
    expect(ids).toHaveLength(250)
    expect(new Set(ids).size).toBe(250)
    // Tras el lote 2 hay 199 filas exportadas pero 200 pedidas: el tercer lote debe pedirse desde 200 (con `filas.length` sería 199).
    expect(pedidos.map(([desde]) => desde)).toEqual([0, 100, 200])
  })
})
