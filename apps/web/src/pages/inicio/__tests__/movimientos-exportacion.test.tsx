import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Hallazgos S-3 y QA-5 de la revisión final: la exportación no avisa «truncado» en falso justo en el tope, no repite
// productos entre lotes y la columna «Ventas» depende del permiso (no solo de las filas cargadas). El tope se
// reduce a 300 filas (3 lotes de 100) para poder probarlo.
const mocks = vi.hoisted(() => ({ leer: vi.fn(), categorias: vi.fn(), descargar: vi.fn() }))
vi.mock('../../../lib/inicioBloques', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../lib/inicioBloques')>()), leerMovimientosPorProducto: mocks.leer }))
vi.mock('../../../lib/categorias', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../lib/categorias')>()), leerCategorias: mocks.categorias }))
vi.mock('../../../lib/exportarCsv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../lib/exportarCsv')>()), TOPE_FILAS_EXPORTACION: 300, descargarCsv: mocks.descargar }))
vi.mock('../../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: { id: 'org-1' } }) }))
vi.mock('../../../hooks/useImagenesProductos', () => ({ useImagenesProductosRenovables: () => ({ imagenes: new Map<string, string>(), renovar: () => undefined }) }))
vi.mock('../../../hooks/usePuedeAccion', () => ({ usePuedeAccion: () => ({ puede: true, isLoading: false }) }))

import { MovimientosPorProducto } from '../tablero/MovimientosPorProducto'

const CONTEXTO = { desde: '2026-10-01', hasta: '2026-10-31', empresaId: null as string | null, depositoId: null as string | null }
const fila = (n: number) => ({
  productoId: `p-${n}`, nombre: `Producto ${n}`, sku: `SKU-${n}`, categoria: 'Periféricos', stockInicial: 8, entradas: 5, salidas: 3,
  ajustes: -2, stockActual: 10, minimo: 5, ventas: 4, ultimoMovimiento: '2026-10-12', estado: 'normal' as const,
})
// Servidor simulado: pagina por bloques (página × tamaño). El bug S-3 (sondeo `(tope, 1)` que la RPC acotaba a la página 100000)
// lo cubre el test directo del hook (`hooks/useExportarCsv.test.tsx`: el lote siempre es de `tamanoLote`); aquí se comprueba el
// comportamiento de punta a punta de la pantalla en el tope.
const servidor = (filas: ReturnType<typeof fila>[]) => async (_ctx: unknown, _f: unknown, pagina: number, tamano: number) => ({
  filas: filas.slice((pagina - 1) * tamano, pagina * tamano), total: filas.length,
})
const abrir = (verVentas = true) => render(<MemoryRouter><MovimientosPorProducto contexto={CONTEXTO} verVentas={verVentas} /></MemoryRouter>)
const productos = (cantidad: number) => Array.from({ length: cantidad }, (_, i) => fila(i + 1))
const exportar = async () => {
  await screen.findByRole('table', { name: 'Movimientos por producto' })
  fireEvent.click(screen.getByRole('button', { name: 'Exportar' }))
  await waitFor(() => expect(mocks.descargar).toHaveBeenCalledTimes(1))
  const [contenido] = mocks.descargar.mock.calls[0] as [string, string]
  return contenido.replace(/^﻿/, '').split('\r\n').filter((linea) => linea !== '')
}

beforeEach(() => {
  mocks.leer.mockReset()
  mocks.categorias.mockReset()
  mocks.categorias.mockResolvedValue({ categorias: [], conteos: new Map() })
  mocks.descargar.mockReset()
})

describe('exportar en el tope de filas', () => {
  it('con exactamente el tope de filas exporta todo y NO avisa que hubo truncado', async () => {
    mocks.leer.mockImplementation(servidor(productos(300)))
    abrir()
    const lineas = await exportar()
    expect(lineas).toHaveLength(301)
    expect(screen.queryByText(/Se exportaron las primeras/)).not.toBeInTheDocument()
  })

  it('con una fila más que el tope exporta el tope y avisa el truncado', async () => {
    mocks.leer.mockImplementation(servidor(productos(301)))
    abrir()
    const lineas = await exportar()
    expect(lineas).toHaveLength(301)
    expect(await screen.findByText(/Se exportaron las primeras 300 filas/)).toBeInTheDocument()
  })

  it('nunca pide una página que desborde: todos los pedidos de exportación van en bloques alineados de 100', async () => {
    mocks.leer.mockImplementation(servidor(productos(301)))
    abrir()
    await exportar()
    const pedidos = mocks.leer.mock.calls.filter((llamada) => llamada[3] === 100).map((llamada) => llamada[2])
    expect(pedidos).toEqual([1, 2, 3, 4])
  })
})

describe('exportar sin repetir productos', () => {
  it('un producto repetido entre lotes (el stock cambió mientras se paginaba) sale una sola vez', async () => {
    const base = productos(150)
    // El bloque 2 empieza repitiendo el último producto del bloque 1 (corrimiento de offset).
    const conRepetido = [...base.slice(0, 100), base[99], ...base.slice(100)]
    mocks.leer.mockImplementation(servidor(conRepetido))
    abrir()
    const lineas = await exportar()
    const nombres = lineas.slice(1).map((linea) => linea.split(';')[0])
    expect(new Set(nombres).size).toBe(nombres.length)
    expect(nombres).toHaveLength(150)
  })
})

describe('columna «Ventas» según el permiso', () => {
  it('sin permiso de ventas el CSV no trae la columna aunque la lista esté vacía', async () => {
    mocks.leer.mockResolvedValue({ filas: [], total: 0 })
    abrir(false)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Exportar' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }))
    await waitFor(() => expect(mocks.descargar).toHaveBeenCalledTimes(1))
    const [contenido] = mocks.descargar.mock.calls[0] as [string, string]
    expect(contenido).toContain('Mínimo;Último movimiento')
    expect(contenido).not.toContain('Ventas')
  })

  it('con permiso de ventas y lista vacía la columna sigue en el CSV', async () => {
    mocks.leer.mockResolvedValue({ filas: [], total: 0 })
    abrir(true)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Exportar' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }))
    await waitFor(() => expect(mocks.descargar).toHaveBeenCalledTimes(1))
    expect((mocks.descargar.mock.calls[0] as [string, string])[0]).toContain('Mínimo;Ventas;Último movimiento')
  })
})

describe('menú de orden y columna «Ventas» según el permiso', () => {
  const abrirMenuOrden = async () => {
    const orden = await screen.findByRole('combobox', { name: 'Ordenar por' })
    fireEvent.mouseDown(orden)
    return screen.findAllByRole('option')
  }

  it('sin permiso de ventas y con la lista vacía el menú de orden no ofrece «Ventas»', async () => {
    mocks.leer.mockResolvedValue({ filas: [], total: 0 })
    abrir(false)
    const opciones = await abrirMenuOrden()
    expect(opciones.map((o) => o.textContent)).not.toContain('Ventas')
  })

  it('sin permiso de ventas y con error en la primera tanda el menú de orden no ofrece «Ventas»', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.leer.mockRejectedValue(new Error('falla la primera tanda'))
    abrir(false)
    await screen.findByText(/No pudimos cargar/i)
    const opciones = await abrirMenuOrden()
    expect(opciones.map((o) => o.textContent)).not.toContain('Ventas')
  })

  it('con permiso de ventas y la lista vacía el menú de orden sí ofrece «Ventas»', async () => {
    mocks.leer.mockResolvedValue({ filas: [], total: 0 })
    abrir(true)
    const opciones = await abrirMenuOrden()
    expect(opciones.map((o) => o.textContent)).toContain('Ventas')
  })
})
