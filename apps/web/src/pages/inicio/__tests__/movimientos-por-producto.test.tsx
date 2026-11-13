import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../test/axe'

// F-INI-06 (MSF-822): listado «Movimientos por producto» del tablero de Inicio.
const mocks = vi.hoisted(() => ({ leer: vi.fn(), categorias: vi.fn(), puedeExportar: { valor: true }, descargar: vi.fn() }))

vi.mock('../../../lib/inicioBloques', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../lib/inicioBloques')>()), leerMovimientosPorProducto: mocks.leer }))
vi.mock('../../../lib/categorias', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../lib/categorias')>()), leerCategorias: mocks.categorias }))
vi.mock('../../../lib/exportarCsv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../lib/exportarCsv')>()), descargarCsv: mocks.descargar }))
vi.mock('../../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: { id: 'org-1' } }) }))
vi.mock('../../../hooks/usePuedeAccion', () => ({ usePuedeAccion: () => ({ puede: mocks.puedeExportar.valor, isLoading: false }) }))

import { MovimientosPorProducto } from '../tablero/MovimientosPorProducto'

const CONTEXTO = { desde: '2026-10-01', hasta: '2026-10-31', empresaId: null as string | null, depositoId: null as string | null }

const fila = (n: number, extra: Record<string, unknown> = {}) => ({
  productoId: `p-${n}`, nombre: `Producto ${n}`, sku: `SKU-${n}`, categoria: 'Periféricos', stockInicial: 8, entradas: 5, salidas: 3,
  ajustes: -2, stockActual: 10, minimo: 5, ventas: 4, ultimoMovimiento: '2026-10-12', estado: 'normal', ...extra,
})

const CATEGORIAS = [
  { id: 'c-1', nombre: 'Periféricos', padre_id: null, posicion: 1, empresa_ids: ['e-1', 'e-2'] },
  { id: 'c-2', nombre: 'Solo Mundo JC', padre_id: null, posicion: 2, empresa_ids: ['e-2'] },
]

const abrir = (contexto = CONTEXTO) => render(<MemoryRouter><MovimientosPorProducto contexto={contexto} /></MemoryRouter>)
const ultimaLlamada = () => mocks.leer.mock.calls[mocks.leer.mock.calls.length - 1]

beforeEach(() => {
  mocks.leer.mockReset()
  mocks.leer.mockResolvedValue({ filas: [fila(1), fila(2, { sku: null, estado: 'alerta', ventas: 0 })], total: 2 })
  mocks.categorias.mockReset()
  mocks.categorias.mockResolvedValue({ categorias: CATEGORIAS, conteos: new Map() })
  mocks.descargar.mockReset()
  mocks.puedeExportar.valor = true
})
afterEach(() => vi.restoreAllMocks())

describe('listado (FR-012, CA-INI-06-1)', () => {
  it('muestra una fila por producto con las 12 columnas', async () => {
    abrir()
    const tabla = await screen.findByRole('table', { name: 'Movimientos por producto' })
    const encabezados = within(tabla).getAllByRole('columnheader').map((th) => th.textContent)
    expect(encabezados).toEqual(['Producto', 'SKU', 'Categoría', 'Stock inicial', 'Entradas', 'Salidas', 'Ajustes', 'Stock actual', 'Mínimo', 'Ventas', 'Último movimiento', 'Estado'])
    expect(within(tabla).getAllByRole('row')).toHaveLength(3)
    expect(within(tabla).getByText('Producto 1')).toHaveAttribute('href', '/productos/p-1/edit')
    expect(within(tabla).getAllByText('12/10/2026')).toHaveLength(2)
    expect(within(tabla).getAllByText('−2').length).toBeGreaterThan(0)
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Mostrando 2 de 2 productos')
  })

  it('un producto sin SKU muestra «—» y el chip de estado', async () => {
    abrir()
    const tabla = await screen.findByRole('table', { name: 'Movimientos por producto' })
    const filaAlerta = within(tabla).getByText('Producto 2').closest('tr')!
    expect(within(filaAlerta).getAllByText('—').length).toBeGreaterThan(0)
    expect(within(filaAlerta).getByText('En alerta')).toBeInTheDocument()
  })

  it('sin permiso de ventas (todo null) no hay columna Ventas', async () => {
    mocks.leer.mockResolvedValue({ filas: [fila(1, { ventas: null })], total: 1 })
    abrir()
    const tabla = await screen.findByRole('table', { name: 'Movimientos por producto' })
    expect(within(tabla).queryByRole('columnheader', { name: 'Ventas' })).not.toBeInTheDocument()
  })

  it('no muestra costo ni margen', async () => {
    abrir()
    await screen.findByRole('table', { name: 'Movimientos por producto' })
    expect(screen.queryByText(/costo|margen|valor/i)).not.toBeInTheDocument()
  })
})

describe('vistas, búsqueda, categoría y orden (FR-013, CA-INI-06-2..5)', () => {
  it('la vista «En alerta» pide solo esos productos', async () => {
    abrir()
    await screen.findByRole('table', { name: 'Movimientos por producto' })
    fireEvent.click(screen.getByRole('button', { name: 'En alerta' }))
    await waitFor(() => expect(ultimaLlamada()[1]).toMatchObject({ vista: 'alerta' }))
  })

  it('buscar por SKU espera a que termine de escribir y consulta con ese texto', async () => {
    abrir()
    await screen.findByRole('table', { name: 'Movimientos por producto' })
    fireEvent.change(screen.getByLabelText('Buscar producto o SKU'), { target: { value: 'TEC-1' } })
    await waitFor(() => expect(ultimaLlamada()[1]).toMatchObject({ busqueda: 'TEC-1' }), { timeout: 2000 })
  })

  it('elegir una categoría la manda al servidor', async () => {
    abrir()
    await screen.findByRole('table', { name: 'Movimientos por producto' })
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Categoría' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Periféricos' }))
    await waitFor(() => expect(ultimaLlamada()[1]).toMatchObject({ categoriaId: 'c-1' }))
  })

  it('ordenar por Salidas con el encabezado y volver a hacer clic invierte la dirección', async () => {
    abrir()
    await screen.findByRole('table', { name: 'Movimientos por producto' })
    fireEvent.click(screen.getByRole('button', { name: 'Salidas' }))
    await waitFor(() => expect(ultimaLlamada()[1]).toMatchObject({ orden: 'salidas', direccion: 'asc' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salidas' }))
    await waitFor(() => expect(ultimaLlamada()[1]).toMatchObject({ orden: 'salidas', direccion: 'desc' }))
  })

  it('el botón de dirección alterna ascendente y descendente', async () => {
    abrir()
    await screen.findByRole('table', { name: 'Movimientos por producto' })
    fireEvent.click(screen.getByRole('button', { name: '↑ Ascendente' }))
    await waitFor(() => expect(ultimaLlamada()[1]).toMatchObject({ direccion: 'desc' }))
    expect(screen.getByRole('button', { name: '↓ Descendente' })).toBeInTheDocument()
  })
})

describe('tienda, depósito y vacío (CA-INI-06-6, 9, 11)', () => {
  it('con una tienda elegida el menú de categorías muestra solo las de esa tienda', async () => {
    abrir({ ...CONTEXTO, empresaId: 'e-1' })
    await screen.findByRole('table', { name: 'Movimientos por producto' })
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Categoría' }))
    expect(await screen.findByRole('option', { name: 'Periféricos' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Solo Mundo JC' })).not.toBeInTheDocument()
  })

  it('cambiar el depósito del tablero recalcula el listado', async () => {
    const vista = abrir()
    await screen.findByRole('table', { name: 'Movimientos por producto' })
    vista.rerender(<MemoryRouter><MovimientosPorProducto contexto={{ ...CONTEXTO, depositoId: 'd-1' }} /></MemoryRouter>)
    await waitFor(() => expect(ultimaLlamada()[0]).toMatchObject({ depositoId: 'd-1' }))
  })

  it('sin resultados muestra el vacío con «Limpiar filtros», que vuelve a los filtros iniciales', async () => {
    abrir()
    await screen.findByRole('table', { name: 'Movimientos por producto' })
    mocks.leer.mockResolvedValue({ filas: [], total: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'Quietos' }))
    expect(await screen.findByText('Sin movimientos para estos filtros')).toBeInTheDocument()
    mocks.leer.mockResolvedValue({ filas: [fila(1)], total: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    await waitFor(() => expect(ultimaLlamada()[1]).toMatchObject({ vista: 'todos', busqueda: '', categoriaId: null }))
    expect(await screen.findByRole('table', { name: 'Movimientos por producto' })).toBeInTheDocument()
  })

  it('un error muestra el reintento y se recupera', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.leer.mockRejectedValueOnce(new Error('falló'))
    abrir()
    expect(await screen.findByText('No pudimos cargar los movimientos por producto.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('table', { name: 'Movimientos por producto' })).toBeInTheDocument()
  })
})

describe('carga infinita (CA-INI-06-10)', () => {
  it('«Cargar más» suma la tanda siguiente conservando filtros y orden', async () => {
    const pagina1 = Array.from({ length: 25 }, (_, i) => fila(i + 1))
    const pagina2 = Array.from({ length: 5 }, (_, i) => fila(i + 26))
    mocks.leer.mockImplementation(async (_ctx, _filtros, pagina: number) => ({ filas: pagina === 1 ? pagina1 : pagina2, total: 30 }))
    abrir()
    await screen.findByRole('table', { name: 'Movimientos por producto' })
    fireEvent.click(screen.getByRole('button', { name: 'Salidas' }))
    await waitFor(() => expect(ultimaLlamada()[1]).toMatchObject({ orden: 'salidas' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cargar más' }))
    await waitFor(() => expect(ultimaLlamada()[2]).toBe(2))
    expect(ultimaLlamada()[1]).toMatchObject({ orden: 'salidas', direccion: 'asc' })
    await waitFor(() => expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Mostrando 30 de 30 productos'))
    expect(screen.queryByRole('button', { name: /Anterior|Siguiente/ })).not.toBeInTheDocument()
  })
})

describe('exportar (FR-015, CA-INI-06-7/8)', () => {
  it('el rol sin permiso de exportar no ve el botón', async () => {
    mocks.puedeExportar.valor = false
    abrir()
    await screen.findByRole('table', { name: 'Movimientos por producto' })
    expect(screen.queryByRole('button', { name: 'Exportar' })).not.toBeInTheDocument()
  })

  it('exportar baja por lotes con los filtros aplicados y descarga un CSV', async () => {
    mocks.leer.mockImplementation(async (_ctx, _filtros, _pagina: number, tamano: number) => ({ filas: tamano === 100 ? [fila(1), fila(2)] : [fila(1)], total: 2 }))
    abrir()
    await screen.findByRole('table', { name: 'Movimientos por producto' })
    fireEvent.click(screen.getByRole('button', { name: 'Quietos' }))
    await waitFor(() => expect(ultimaLlamada()[1]).toMatchObject({ vista: 'quieto' }))
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }))
    await waitFor(() => expect(mocks.descargar).toHaveBeenCalledTimes(1))
    const lote = mocks.leer.mock.calls.find((llamada) => llamada[3] === 100)!
    expect(lote[1]).toMatchObject({ vista: 'quieto' })
    const [contenido, nombre] = mocks.descargar.mock.calls[0] as [string, string]
    expect(nombre).toMatch(/^movimientos-por-producto-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(contenido).toContain('Producto;SKU;Categoría;Stock inicial')
    expect(contenido).toContain('Producto 1;SKU-1;Periféricos;8;5;3;-2;10;5;4;2026-10-12;Normal')
  })
})

describe('accesibilidad', () => {
  it.each([320, 768, 1440])('sin violaciones de axe a %i px', async (ancho) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: ancho })
    const { container } = abrir()
    await screen.findByRole('table', { name: 'Movimientos por producto' })
    expect(await violacionesAxe(container)).toEqual([])
  })
})
