import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'

// Test de INTEGRACIÓN de la pantalla: filtros + RPC. Con la suite shardeada el default de 5 s quedaba
// justo y daba falsos rojos. Se sube el timeout del archivo.
vi.setConfig({ testTimeout: 20000 })

const mocks = vi.hoisted(() => ({
  listar: vi.fn(),
  useFiltroPorEmpresaActiva: vi.fn(),
  useOrganizacionActiva: vi.fn(),
  cambiarFiltro: vi.fn(),
}))

vi.mock('../../lib/ventasFaltantes', async (original) => ({
  ...(await original<typeof import('../../lib/ventasFaltantes')>()),
  listarFaltantes: mocks.listar,
}))
vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: mocks.useFiltroPorEmpresaActiva }))
vi.mock('../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: mocks.useOrganizacionActiva }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { FaltantesList } from './faltantes'
import app from '../../App.tsx?raw'
import { celular } from '../../test/matchMedia'

const fila = (n: number, empresaId: string, empresa: string) => ({
  id: `f-${n}`,
  empresa_id: empresaId,
  empresa,
  cliente: `Cliente ${n}`,
  producto: `Producto ${n}`,
  sku: `SKU-${n}`,
  cantidad_faltante: 3,
  linea_orden: 1,
  comprobante_id: `comp-${n}`,
  comprobante: `0003-${n}`,
  fecha: '2026-10-01',
  desde: '2026-10-01T10:00:00Z',
  stock_estado: 'disponible' as const,
  stock_disponible: 5,
})

const TODAS = [fila(1, 'e-1', 'San Javucho'), fila(2, 'e-2', 'Mundo JC')]
const empresas = [{ id: 'e-1', nombre: 'San Javucho' }, { id: 'e-2', nombre: 'Mundo JC' }]

// La empresa activa manda y el filtro de la pantalla la sobreescribe hasta que cambie (como el hook real).
let empresaActivaId: string | null = null

const abrir = () => render(<MemoryRouter><FaltantesList /></MemoryRouter>)

describe('FaltantesList · empresa activa (F-VTA-18, FR-044, FR-046)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    empresaActivaId = null
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.useOrganizacionActiva.mockReturnValue({ organizacionActiva: { id: 'org-1' }, isLoading: false })
    mocks.useFiltroPorEmpresaActiva.mockImplementation(() => ({
      empresas,
      valor: empresaActivaId,
      cambiar: mocks.cambiarFiltro,
      empresaActivaId,
      cargando: false,
      hayError: false,
    }))
    mocks.listar.mockImplementation(async ({ empresaId }: { empresaId: string | null }) => {
      const filas = TODAS.filter((f) => !empresaId || f.empresa_id === empresaId)
      return { faltantes: filas, total: filas.length }
    })
  })

  it('lista los faltantes de todas las tiendas y muestra el total', async () => {
    abrir()
    expect(await screen.findByText('Producto 1')).toBeInTheDocument()
    expect(screen.getByText('Producto 2')).toBeInTheDocument()
    expect(mocks.listar).toHaveBeenCalledWith({ empresaId: null, pagina: 1, tamano: 10 })
  })

  it('muestra el título «Faltantes» y su descripción (FR-044)', async () => {
    abrir()
    expect(await screen.findByRole('heading', { name: 'Faltantes', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('Líneas vendidas o pedidas sin stock.')).toBeInTheDocument()
  })

  it('ofrece el filtro de tienda con su texto de ayuda y filtra por la tienda elegida (FR-044)', async () => {
    abrir()
    await screen.findByText('Producto 1')

    // El texto de ayuda es el del prototipo: el filtro sigue a la empresa activa de la barra superior.
    expect(
      screen.getByText('Por defecto se ven todas; si elegís una empresa en la barra superior, se filtra por esa tienda.'),
    ).toBeInTheDocument()

    const grupo = screen.getByRole('group', { name: 'Filtrar por tienda' })
    expect(within(grupo).getByRole('button', { name: 'Todas las tiendas' })).toBeInTheDocument()
    expect(within(grupo).getByRole('button', { name: 'San Javucho' })).toBeInTheDocument()

    fireEvent.click(within(grupo).getByRole('button', { name: 'Mundo JC' }))
    expect(mocks.cambiarFiltro).toHaveBeenCalledWith('e-2')
  })

  it('muestra el estado de carga mientras llegan los faltantes (FR-044)', async () => {
    let resolver: (v: unknown) => void = () => {}
    mocks.listar.mockImplementationOnce(() => new Promise((r) => { resolver = r }))

    abrir()
    expect(await screen.findByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()

    await act(async () => { resolver({ faltantes: [TODAS[0]], total: 1 }) })
    expect(await screen.findByText('Producto 1')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Cargando contenido' })).not.toBeInTheDocument()
  })

  it('la paginación muestra el rango y el total de faltantes (FR-044)', async () => {
    mocks.listar.mockImplementation(async () => ({ faltantes: TODAS, total: 30 }))
    abrir()
    expect(await screen.findByText('Producto 1')).toBeInTheDocument()
    expect(screen.getByText('1–10 de 30')).toBeInTheDocument()
    expect(screen.getByText('30 faltantes')).toBeInTheDocument()
  })

  it('al cambiar la empresa activa recarga acotada a ella y no deja filas de la anterior', async () => {
    const { rerender } = abrir()
    expect(await screen.findByText('Producto 1')).toBeInTheDocument()
    expect(screen.getByText('Producto 2')).toBeInTheDocument()

    // La consulta de la nueva empresa queda en vuelo: mientras llega, no se dibuja ninguna fila de la anterior.
    let resolver: (v: unknown) => void = () => {}
    mocks.listar.mockImplementationOnce(() => new Promise((r) => { resolver = r }))

    empresaActivaId = 'e-1'
    rerender(<MemoryRouter><FaltantesList /></MemoryRouter>)

    await waitFor(() => expect(mocks.listar).toHaveBeenCalledWith({ empresaId: 'e-1', pagina: 1, tamano: 10 }))
    expect(screen.queryByText('Producto 2')).not.toBeInTheDocument()

    resolver({ faltantes: [TODAS[0]], total: 1 })
    expect(await screen.findByText('Producto 1')).toBeInTheDocument()
    expect(screen.queryByText('Producto 2')).not.toBeInTheDocument()
  })

  it('al cambiar la empresa activa reencuadra la paginación: una sola consulta, ya en la primera página', async () => {
    // Con muchas filas hay varias páginas: se pide la segunda.
    mocks.listar.mockImplementation(async ({ empresaId }: { empresaId: string | null }) => {
      const filas = TODAS.filter((f) => !empresaId || f.empresa_id === empresaId)
      return { faltantes: filas, total: 30 }
    })
    const { rerender } = abrir()
    expect(await screen.findByText('Producto 1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente/i }))
    await waitFor(() => expect(mocks.listar).toHaveBeenCalledWith({ empresaId: null, pagina: 2, tamano: 10 }))

    empresaActivaId = 'e-1'
    rerender(<MemoryRouter><FaltantesList /></MemoryRouter>)

    await waitFor(() => expect(mocks.listar).toHaveBeenCalledWith({ empresaId: 'e-1', pagina: 1, tamano: 10 }))
    // La consulta de la nueva empresa sale una sola vez: no se pide la página que ya no correspondía.
    const consultasDeLaNuevaEmpresa = mocks.listar.mock.calls.filter(([filtros]) => filtros.empresaId === 'e-1')
    expect(consultasDeLaNuevaEmpresa).toHaveLength(1)
  })

  it('muestra las columnas del prototipo con la cantidad faltante y el stock de hoy', async () => {
    abrir()
    expect(await screen.findByText('Producto 1')).toBeInTheDocument()
    for (const encabezado of ['Tienda', 'Cliente', 'Producto', 'Pedido', 'Comprobante', 'Desde', 'Stock hoy']) {
      expect(screen.getAllByText(encabezado).length).toBeGreaterThan(0)
    }
    // «Pedido» son las unidades que faltan (no una cantidad de compra) y el stock de hoy va rotulado.
    expect(screen.getAllByText('3 unidades').length).toBeGreaterThan(0)
    expect(screen.getAllByText('5 unidades').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Disponible').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: '0003-1' })).toHaveAttribute('href', '/ventas/comprobantes/comp-1')
  })

  it('sin faltantes muestra «Sin resultados»', async () => {
    mocks.listar.mockResolvedValue({ faltantes: [], total: 0 })
    abrir()
    expect(await screen.findByText('Sin resultados')).toBeInTheDocument()
    expect(screen.getByText('No hay faltantes abiertos en las tiendas que podés ver.')).toBeInTheDocument()
  })

  it('si la lectura falla muestra el error y deja reintentar', async () => {
    mocks.listar.mockRejectedValueOnce({ code: '42501', message: 'permission denied' })
    abrir()
    expect(await screen.findByText('No pudimos cargar los faltantes.')).toBeInTheDocument()

    mocks.listar.mockResolvedValueOnce({ faltantes: [TODAS[0]], total: 1 })
    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }))
    expect(await screen.findByText('Producto 1')).toBeInTheDocument()
  })

  it('es solo lectura: no ofrece acciones de escritura sobre los faltantes', async () => {
    abrir()
    expect(await screen.findByText('Producto 1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /registrar|resolver|editar/i })).not.toBeInTheDocument()
  })

  it('si la página quedó sin filas vuelve a la primera (p. ej. se resolvieron los faltantes)', async () => {
    mocks.listar.mockImplementation(async ({ pagina }: { pagina: number }) =>
      pagina === 1 ? { faltantes: TODAS, total: 30 } : { faltantes: [], total: 30 },
    )
    abrir()
    expect(await screen.findByText('Producto 1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente/i }))
    await waitFor(() => expect(mocks.listar).toHaveBeenCalledWith({ empresaId: null, pagina: 2, tamano: 10 }))

    // La segunda página vino vacía: la pantalla vuelve a la primera y vuelve a mostrar las filas.
    await waitFor(() => expect(mocks.listar).toHaveBeenCalledWith({ empresaId: null, pagina: 1, tamano: 10 }))
    expect(await screen.findByText('Producto 1')).toBeInTheDocument()
  })
})

// T034: en pantallas angostas la tabla se condensa en tarjetas con los mismos datos.
describe('FaltantesList · pantalla angosta (F-VTA-18, FR-044)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    empresaActivaId = null
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.useOrganizacionActiva.mockReturnValue({ organizacionActiva: { id: 'org-1' }, isLoading: false })
    mocks.useFiltroPorEmpresaActiva.mockImplementation(() => ({
      empresas,
      valor: empresaActivaId,
      cambiar: mocks.cambiarFiltro,
      empresaActivaId,
      cargando: false,
      hayError: false,
    }))
    mocks.listar.mockImplementation(async ({ empresaId }: { empresaId: string | null }) => {
      const filas = TODAS.filter((f) => !empresaId || f.empresa_id === empresaId)
      return { faltantes: filas, total: filas.length }
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
  })

  it('muestra tarjetas con los mismos datos que la tabla', async () => {
    celular(true)
    abrir()

    expect(await screen.findByText('Producto 1')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    // Cada dato de la tabla aparece rotulado en la tarjeta (una vez por tarjeta).
    for (const etiqueta of ['Tienda', 'Cliente', 'Producto', 'Pedido', 'Comprobante', 'Desde', 'Stock hoy']) {
      expect(screen.getAllByText(etiqueta).length).toBeGreaterThanOrEqual(2)
    }
    // Y con sus valores: producto con SKU, unidades que faltan y stock de hoy.
    expect(screen.getByText('SKU-1')).toBeInTheDocument()
    expect(screen.getAllByText('3 unidades').length).toBeGreaterThan(0)
    expect(screen.getAllByText('5 unidades').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: '0003-1' })).toHaveAttribute('href', '/ventas/comprobantes/comp-1')
  })
})

// FR-045: la entrada de menú y sus permisos los cubre `destinosPanel.permisos.test.ts`; acá se verifica que la
// ruta de la pantalla está guardada por la sección `ventas` (la misma convención de `App.guard.test.ts`).
describe('ruta de Faltantes (F-VTA-18, FR-045)', () => {
  it('la ruta /ventas/faltantes exige acceso a la sección ventas', () => {
    const bloque = app.split(/<Route\b/).find((parte) => parte.includes('path="/ventas/faltantes"'))
    expect(bloque, 'la ruta /ventas/faltantes no está en App.tsx').toBeDefined()
    expect(bloque).toContain('<RequiereAccesoSeccion seccion="ventas">')
  })
})
