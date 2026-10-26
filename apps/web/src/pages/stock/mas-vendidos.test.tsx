import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ listar: vi.fn(), useEmpresasAccesibles: vi.fn(), useNivelSeccion: vi.fn() }))

// La capa de datos (RPC) va mockeada; la pantalla, el hook y el filtro de tienda son los reales.
vi.mock('../../lib/masVendidos', async (original) => ({
  ...(await original<typeof import('../../lib/masVendidos')>()),
  listarMasVendidos: mocks.listar,
}))
vi.mock('../../lib/periodosRanking', async (original) => {
  const real = await original<typeof import('../../lib/periodosRanking')>()
  // «Hoy» fijo: 15/10/2026.
  return { ...real, rangoDeAtajo: (atajo: Parameters<typeof real.rangoDeAtajo>[0]) => real.rangoDeAtajo(atajo, new Date('2026-10-15T15:00:00Z')) }
})
vi.mock('../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: mocks.useEmpresasAccesibles }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: { id: 'org-1', nombre: 'Org' }, isLoading: false }) }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { MasVendidosStock } from './mas-vendidos'
import { PestanasStock } from './PestanasStock'

type Fila = { posicion: number; producto_id: string; nombre: string; sku: string | null; unidades: number }

const fila = (n: number, extra: Partial<Fila> = {}): Fila => ({
  posicion: n, producto_id: `p-${n}`, nombre: `Producto ${n}`, sku: `SKU-${n}`, unidades: 100 - n, ...extra,
})

const empresas = [{ id: 'e-1', nombre: 'San Javucho' }, { id: 'e-2', nombre: 'Mundo JC' }]
const estado = { empresaActivaId: null as string | null, total: 0, error: false }

// Contrato de ruta (FR-401): la ruta vive en `App.tsx`; se lee el fuente para comprobar que
// quedó registrada, con carga diferida y protegida por la sección `stock`.
const fuenteApp = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../App.tsx'), 'utf8')
const bloqueRuta = (() => {
  const inicio = fuenteApp.indexOf('path="/stock/mas-vendidos"')
  if (inicio < 0) return ''
  return fuenteApp.slice(inicio, fuenteApp.indexOf('</Route>', inicio))
})()

const abrir = () => render(<MemoryRouter><MasVendidosStock /></MemoryRouter>)
const abrirPestanas = () => render(<MemoryRouter><PestanasStock activa="mas-vendidos" /></MemoryRouter>)
const ultimosFiltros = () => mocks.listar.mock.calls.at(-1)![0]
const pedidosDe = (empresaId: string) => mocks.listar.mock.calls.filter(([filtros]) => filtros.empresaId === empresaId)

describe('MasVendidosStock · reporte de productos más vendidos (F-STK-18)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    estado.empresaActivaId = null
    estado.total = 0
    estado.error = false
    mocks.useEmpresasAccesibles.mockReturnValue({
      empresas, empresaActivaId: estado.empresaActivaId, isLoading: false, isError: false, refetch: vi.fn(),
    })
    // Rol de lectura por defecto: «Más vendidos» es un reporte de lectura (FR-401).
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    mocks.listar.mockImplementation(async ({ empresaId }: { empresaId: string | null }) => {
      if (estado.error) throw new Error('boom')
      const filas = empresaId === 'e-2' ? [fila(2)] : [fila(1), fila(2)]
      return { filas, total: estado.total || filas.length }
    })
  })

  it('muestra las columnas Posición · Producto (nombre y SKU) · Unidades vendidas (FR-405)', async () => {
    abrir()
    expect(await screen.findByText('Producto 1')).toBeInTheDocument()
    for (const encabezado of ['Posición', 'Producto', 'Unidades vendidas']) {
      expect(screen.getByRole('columnheader', { name: encabezado })).toBeInTheDocument()
    }
    expect(screen.getByText('SKU-1')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '99' })).toBeInTheDocument()
  })

  it('aclara qué comprobantes cuentan y cuáles no (FR-402)', async () => {
    abrir()
    expect(await screen.findByText('Producto 1')).toBeInTheDocument()
    // El pie dice exactamente lo que cuenta el predicado único de la base: facturas que no están
    // en borrador ni anuladas; los presupuestos no suman.
    expect(screen.getByText(/Cuentan las facturas que no están en borrador ni anuladas/)).toBeInTheDocument()
    expect(screen.getByText(/los presupuestos no suman/)).toBeInTheDocument()
    expect(screen.getByText(/Unidades vendidas del 01\/10\/2026 al 15\/10\/2026/)).toBeInTheDocument()
  })

  it('un producto sin SKU muestra un guion y no un identificador interno (FR-405)', async () => {
    mocks.listar.mockResolvedValue({ filas: [fila(1, { sku: null })], total: 1 })
    abrir()
    expect(await screen.findByText('Producto 1')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText(/p-1/)).not.toBeInTheDocument()
  })

  it('pagina de a 25 y la página pedida llega a la consulta (FR-405)', async () => {
    estado.total = 60
    abrir()
    await screen.findByText('Producto 1')
    expect(ultimosFiltros()).toMatchObject({ pagina: 1, tamano: 25 })
    expect(screen.getByText('1–25 de 60')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente/i }))
    await waitFor(() => expect(ultimosFiltros()).toMatchObject({ pagina: 2, tamano: 25 }))
    expect(screen.getByText('26–50 de 60')).toBeInTheDocument()
  })

  it('el filtro de tienda ofrece «Todas las tiendas» y una por empresa (FR-406)', async () => {
    abrir()
    expect(await screen.findByText('Producto 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Todas las tiendas' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'San Javucho' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mundo JC' })).toBeInTheDocument()
    expect(ultimosFiltros()).toMatchObject({ empresaId: null })
  })

  it('elegir una tienda recarga acotada a ella y vuelve a la primera página (FR-406)', async () => {
    estado.total = 60
    abrir()
    await screen.findByText('Producto 1')
    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente/i }))
    await waitFor(() => expect(ultimosFiltros()).toMatchObject({ pagina: 2 }))

    fireEvent.click(screen.getByRole('button', { name: 'Mundo JC' }))
    await waitFor(() => expect(ultimosFiltros()).toMatchObject({ empresaId: 'e-2', pagina: 1 }))
  })

  it('con una empresa activa en la barra superior filtra por esa tienda (FR-406, Principio VIII)', async () => {
    estado.empresaActivaId = 'e-1'
    mocks.useEmpresasAccesibles.mockReturnValue({
      empresas, empresaActivaId: estado.empresaActivaId, isLoading: false, isError: false, refetch: vi.fn(),
    })
    abrir()
    await screen.findByText('Producto 1')
    expect(ultimosFiltros()).toMatchObject({ empresaId: 'e-1' })
  })

  it('cambiar la empresa activa reencuadra: primera página y sin filas de la empresa anterior (FR-406, SC-402)', async () => {
    estado.empresaActivaId = 'e-1'
    estado.total = 60
    mocks.useEmpresasAccesibles.mockReturnValue({
      empresas, empresaActivaId: estado.empresaActivaId, isLoading: false, isError: false, refetch: vi.fn(),
    })
    const { rerender } = abrir()
    await screen.findByText('Producto 1')
    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente/i }))
    await waitFor(() => expect(ultimosFiltros()).toMatchObject({ pagina: 2 }))

    // La respuesta de la nueva empresa tarda: no puede verse nada de la anterior.
    let resolver: (valor: unknown) => void = () => undefined
    mocks.listar.mockImplementationOnce(() => new Promise((resuelto) => { resolver = resuelto }))
    estado.empresaActivaId = 'e-2'
    mocks.useEmpresasAccesibles.mockReturnValue({
      empresas, empresaActivaId: estado.empresaActivaId, isLoading: false, isError: false, refetch: vi.fn(),
    })
    rerender(<MemoryRouter><MasVendidosStock /></MemoryRouter>)

    expect(screen.queryByText('Producto 1')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Cargando contenido')).toBeInTheDocument()
    await waitFor(() => expect(ultimosFiltros()).toMatchObject({ empresaId: 'e-2', pagina: 1 }))

    resolver({ filas: [fila(2)], total: 1 })
    expect(await screen.findByText('Producto 2')).toBeInTheDocument()
    expect(screen.queryByText('Producto 1')).not.toBeInTheDocument()
    expect(pedidosDe('e-2')).toHaveLength(1)
  })

  it('cambiar de período recalcula y vuelve a la primera página (FR-404, SC-402)', async () => {
    estado.total = 60
    abrir()
    await screen.findByText('Producto 1')
    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente/i }))
    await waitFor(() => expect(ultimosFiltros()).toMatchObject({ pagina: 2 }))

    fireEvent.click(screen.getByRole('button', { name: 'Mes anterior' }))
    await waitFor(() => expect(ultimosFiltros()).toMatchObject({ desde: '2026-09-01', hasta: '2026-09-30', pagina: 1 }))
  })

  it('arranca en «Este mes» y los atajos completan el período (FR-404)', async () => {
    abrir()
    expect(screen.getByLabelText('Desde')).toHaveValue('2026-10-01')
    expect(screen.getByLabelText('Hasta')).toHaveValue('2026-10-15')
    await waitFor(() => expect(ultimosFiltros()).toMatchObject({ desde: '2026-10-01', hasta: '2026-10-15' }))

    fireEvent.click(screen.getByRole('button', { name: 'Año en curso' }))
    await waitFor(() => expect(ultimosFiltros()).toMatchObject({ desde: '2026-01-01', hasta: '2026-10-15' }))
  })

  it('un rango inválido muestra el error en el campo y no consulta (FR-404)', async () => {
    abrir()
    await screen.findByText('Producto 1')
    const consultas = mocks.listar.mock.calls.length
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-09-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }))
    expect(screen.getByText('Hasta no puede ser anterior a Desde.')).toBeInTheDocument()
    expect(mocks.listar.mock.calls.length).toBe(consultas)
  })

  it('mientras carga muestra el estado de carga y no la tabla (FR-407)', async () => {
    let resolver: (valor: unknown) => void = () => undefined
    mocks.listar.mockImplementationOnce(() => new Promise((resuelto) => { resolver = resuelto }))
    abrir()
    expect(screen.getByLabelText('Cargando contenido')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    resolver({ filas: [], total: 0 })
  })

  it('sin ventas muestra el vacío «No hay ventas en el período» (FR-407)', async () => {
    mocks.listar.mockResolvedValue({ filas: [], total: 0 })
    abrir()
    expect(await screen.findByText('No hay ventas en el período')).toBeInTheDocument()
    expect(screen.getByText('Probá con otro rango de fechas o con otra tienda.')).toBeInTheDocument()
  })

  it('ante un error muestra el estado de error y reintenta (FR-407)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    estado.error = true
    abrir()
    expect(await screen.findByText('No pudimos cargar los productos más vendidos.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(mocks.listar.mock.calls.length).toBeGreaterThan(1))
  })

  it('la pestaña «Más vendidos» está disponible con rol de lectura (FR-401)', () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    abrirPestanas()
    expect(screen.getByRole('tab', { name: 'Más vendidos' })).toHaveAttribute('href', '/stock/mas-vendidos')
  })

  it('la pestaña «Más vendidos» está disponible con rol de edición (FR-401)', () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    abrirPestanas()
    expect(screen.getByRole('tab', { name: 'Más vendidos' })).toHaveAttribute('href', '/stock/mas-vendidos')
  })

  it('la pestaña «Más vendidos» va al final, después de «Actualizar por Excel» (FR-401)', () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    abrirPestanas()
    const pestanas = screen.getAllByRole('tab')
    const indice = (nombre: string) => pestanas.findIndex((pestana) => pestana.textContent === nombre)
    expect(indice('Actualizar por Excel')).toBeGreaterThan(-1)
    expect(indice('Más vendidos')).toBe(indice('Actualizar por Excel') + 1)
    expect(pestanas.at(-1)).toHaveAttribute('href', '/stock/mas-vendidos')
  })

  it('la pantalla abre con la pestaña «Más vendidos» marcada (FR-401)', async () => {
    abrir()
    expect(await screen.findByText('Producto 1')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Más vendidos', selected: true })).toBeInTheDocument()
  })

  it('la ruta /stock/mas-vendidos está registrada, con carga diferida y protegida por la sección stock (FR-401)', () => {
    expect(fuenteApp).toContain("const MasVendidosStock = lazy(() => import('./pages/stock/mas-vendidos')")
    expect(bloqueRuta).toContain('<MasVendidosStock />')
    expect(bloqueRuta).toContain('seccion="stock"')
  })
})
