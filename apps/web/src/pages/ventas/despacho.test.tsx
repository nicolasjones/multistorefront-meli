import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'

// Test de INTEGRACIÓN de la pantalla: filtros + RPC. Con la suite shardeada el default de 5 s quedaba justo.
vi.setConfig({ testTimeout: 20000 })

const mocks = vi.hoisted(() => ({
  listar: vi.fn(),
  useFiltroPorEmpresaActiva: vi.fn(),
  useOrganizacionActiva: vi.fn(),
  cambiarFiltro: vi.fn(),
}))

vi.mock('../../lib/ventasDespachoLista', async (original) => ({
  ...(await original<typeof import('../../lib/ventasDespachoLista')>()),
  listarDespacho: mocks.listar,
}))
vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: mocks.useFiltroPorEmpresaActiva }))
vi.mock('../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: mocks.useOrganizacionActiva }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { DespachoList } from './despacho'
import app from '../../App.tsx?raw'
import { celular } from '../../test/matchMedia'
import { DESTINOS_PANEL, SECCIONES_PANEL } from '../../components/navegacion/destinosPanel'
import { normalizarConteos, type FilaDespacho } from '../../lib/ventasDespachoLista'

const fila = (n: number, empresaId: string, empresa: string, extra: Partial<FilaDespacho> = {}): FilaDespacho => ({
  id: `c-${n}`,
  numero: `0003-${n}`,
  empresa_id: empresaId,
  empresa,
  fecha: '2026-12-10',
  cliente: `Cliente ${n}`,
  estado_despacho: 'sin_armar',
  armo: null,
  controlo: null,
  entrego: null,
  transporte: null,
  guia: null,
  fecha_envio: null,
  puede_despachar: true,
  ...extra,
})

const TODAS = [
  fila(1, 'e-1', 'San Javucho', { estado_despacho: 'armando', armo: 'Ana Pérez' }),
  fila(2, 'e-2', 'Mundo JC', { transporte: 'Expreso Uno', guia: 'GUIA-77', fecha_envio: '2026-12-20' }),
]
const CONTEOS = { sin_armar: 1, armando: 1, incompleto: 0, listo_para_despachar: 0, entregado: 0 }
const empresas = [{ id: 'e-1', nombre: 'San Javucho' }, { id: 'e-2', nombre: 'Mundo JC' }]

// La empresa activa manda y el filtro de la pantalla la sobreescribe hasta que cambie (como el hook real).
let empresaActivaId: string | null = null

const abrir = () => render(<MemoryRouter><DespachoList /></MemoryRouter>)

describe('DespachoList · tablero (F-VTA-17, FR-031, FR-033)', () => {
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
    mocks.listar.mockImplementation(async ({ empresaId, estado }: { empresaId: string | null; estado: string | null }) => {
      const filas = TODAS.filter((f) => (!empresaId || f.empresa_id === empresaId) && (!estado || f.estado_despacho === estado))
      return { filas, total: filas.length, conteos: normalizarConteos(CONTEOS) }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('lista las facturas de todas las tiendas con el título y el total', async () => {
    abrir()
    expect(await screen.findByRole('heading', { name: 'Despacho', level: 1 })).toBeInTheDocument()
    expect(await screen.findByText('Cliente 1')).toBeInTheDocument()
    expect(screen.getByText('Cliente 2')).toBeInTheDocument()
    expect(screen.getByText('2 facturas')).toBeInTheDocument()
    expect(mocks.listar).toHaveBeenCalledWith({ busqueda: '', estado: null, empresaId: null, pagina: 1, tamano: 10 })
  })

  it('muestra las columnas: comprobante, tienda, fecha, cliente, estado, responsables y transporte y guía', async () => {
    abrir()
    await screen.findByText('Cliente 1')
    for (const encabezado of ['Comprobante', 'Tienda', 'Fecha', 'Cliente', 'Estado', 'Responsables', 'Transporte y guía']) {
      expect(screen.getAllByText(encabezado).length).toBeGreaterThan(0)
    }
    expect(screen.getByText('Armó: Ana Pérez')).toBeInTheDocument()
    expect(screen.getAllByText('Controló: —').length).toBeGreaterThan(0)
    expect(screen.getByText('Expreso Uno')).toBeInTheDocument()
    expect(screen.getByText(/GUIA-77/)).toBeInTheDocument()
    // La etiqueta del estado de la fila (la píldora del filtro lleva el conteo: «Armando (1)»).
    expect(screen.getByText('Armando')).toBeInTheDocument()
  })

  it('cada fila abre el comprobante', async () => {
    abrir()
    expect(await screen.findByRole('link', { name: '0003-1' })).toHaveAttribute('href', '/ventas/comprobantes/c-1')
  })

  it('es de solo lectura: no ofrece acciones de despacho sobre las filas (lectura)', async () => {
    abrir()
    await screen.findByText('Cliente 1')
    for (const accion of ['Entregar', 'Controlar', 'Empezar a armar']) {
      expect(screen.queryByRole('button', { name: accion })).not.toBeInTheDocument()
    }
  })

  it('el filtro de estado muestra los conteos y consulta por el estado elegido', async () => {
    abrir()
    await screen.findByText('Cliente 1')
    const grupo = screen.getByRole('group', { name: 'Filtrar por estado' })
    expect(within(grupo).getByRole('button', { name: 'Todos (2)' })).toBeInTheDocument()
    expect(within(grupo).getByRole('button', { name: 'Sin armar (1)' })).toBeInTheDocument()
    expect(within(grupo).getByRole('button', { name: 'Armando (1)' })).toBeInTheDocument()
    expect(within(grupo).getByRole('button', { name: 'Incompleto (0)' })).toBeInTheDocument()
    expect(within(grupo).getByRole('button', { name: 'Listo para despachar (0)' })).toBeInTheDocument()
    expect(within(grupo).getByRole('button', { name: 'Entregado (0)' })).toBeInTheDocument()

    fireEvent.click(within(grupo).getByRole('button', { name: 'Armando (1)' }))
    await waitFor(() =>
      expect(mocks.listar).toHaveBeenCalledWith({ busqueda: '', estado: 'armando', empresaId: null, pagina: 1, tamano: 10 }),
    )
    // Los conteos de las píldoras siguen siendo los del tablero, no se vacían al elegir un estado.
    expect(await within(grupo).findByRole('button', { name: 'Sin armar (1)' })).toBeInTheDocument()
    expect(screen.queryByText('Cliente 2')).not.toBeInTheDocument()
  })

  it('«Buscar por cliente o número» consulta tras dejar de tipear y vuelve a la primera página', async () => {
    abrir()
    await screen.findByText('Cliente 1')
    fireEvent.change(screen.getByLabelText('Buscar por cliente o número'), { target: { value: 'Cliente 2' } })
    await waitFor(() =>
      expect(mocks.listar).toHaveBeenCalledWith({ busqueda: 'Cliente 2', estado: null, empresaId: null, pagina: 1, tamano: 10 }),
    )
  })

  it('sin resultados muestra «Sin resultados» y «Limpiar filtros» los saca', async () => {
    mocks.listar.mockImplementation(async ({ busqueda }: { busqueda: string }) => ({
      filas: busqueda ? [] : TODAS,
      total: busqueda ? 0 : 2,
      conteos: normalizarConteos(CONTEOS),
    }))
    abrir()
    await screen.findByText('Cliente 1')
    fireEvent.change(screen.getByLabelText('Buscar por cliente o número'), { target: { value: 'nadie' } })
    expect(await screen.findByText('Sin resultados')).toBeInTheDocument()
    expect(screen.getByText('Probá con otra búsqueda o limpiá los filtros.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    expect(await screen.findByText('Cliente 1')).toBeInTheDocument()
  })

  it('sin facturas y sin filtros dice que no hay nada por despachar', async () => {
    mocks.listar.mockResolvedValue({ filas: [], total: 0, conteos: normalizarConteos({}) })
    abrir()
    expect(await screen.findByText('Sin resultados')).toBeInTheDocument()
    expect(screen.getByText('No hay facturas por despachar en las tiendas que podés ver.')).toBeInTheDocument()
  })

  it('muestra el estado de carga mientras llegan las facturas', async () => {
    let resolver: (v: unknown) => void = () => {}
    mocks.listar.mockImplementationOnce(() => new Promise((r) => { resolver = r }))
    abrir()
    expect(await screen.findByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
    await act(async () => { resolver({ filas: [TODAS[0]], total: 1, conteos: normalizarConteos(CONTEOS) }) })
    expect(await screen.findByText('Cliente 1')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Cargando contenido' })).not.toBeInTheDocument()
  })

  it('ante un error muestra «Reintentar» y reintenta la consulta', async () => {
    mocks.listar.mockRejectedValueOnce(new Error('falló'))
    abrir()
    expect(await screen.findByText('No pudimos cargar el despacho.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Cliente 1')).toBeInTheDocument()
  })

  it('la paginación muestra el rango y el total de facturas', async () => {
    mocks.listar.mockResolvedValue({ filas: TODAS, total: 30, conteos: normalizarConteos(CONTEOS) })
    abrir()
    expect(await screen.findByText('Cliente 1')).toBeInTheDocument()
    expect(screen.getByText('1–10 de 30')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente/i }))
    await waitFor(() =>
      expect(mocks.listar).toHaveBeenCalledWith({ busqueda: '', estado: null, empresaId: null, pagina: 2, tamano: 10 }),
    )
  })

  it('en pantalla angosta se ven tarjetas con los mismos datos', async () => {
    celular(true)
    abrir()
    expect(await screen.findByText('Cliente 1')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '0003-1' })).toBeInTheDocument()
    expect(screen.getByText('Expreso Uno')).toBeInTheDocument()
  })
})

describe('DespachoList · empresa activa (F-VTA-17, FR-033, Principio VIII)', () => {
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
      return { filas, total: filas.length, conteos: normalizarConteos(CONTEOS) }
    })
  })

  it('ofrece el filtro de tienda con su texto de ayuda y filtra por la tienda elegida', async () => {
    abrir()
    await screen.findByText('Cliente 1')
    expect(
      screen.getByText('Por defecto se ven todas; si elegís una empresa en la barra superior, se filtra por esa tienda.'),
    ).toBeInTheDocument()
    const grupo = screen.getByRole('group', { name: 'Filtrar por tienda' })
    expect(within(grupo).getByRole('button', { name: 'Todas las tiendas' })).toBeInTheDocument()
    fireEvent.click(within(grupo).getByRole('button', { name: 'Mundo JC' }))
    expect(mocks.cambiarFiltro).toHaveBeenCalledWith('e-2')
  })

  it('al cambiar la empresa activa recarga acotada a ella y no deja filas de la anterior', async () => {
    const { rerender } = abrir()
    expect(await screen.findByText('Cliente 1')).toBeInTheDocument()
    expect(screen.getByText('Cliente 2')).toBeInTheDocument()

    // La consulta de la nueva empresa queda en vuelo: mientras llega, no se dibuja ninguna fila de la anterior.
    let resolver: (v: unknown) => void = () => {}
    mocks.listar.mockImplementationOnce(() => new Promise((r) => { resolver = r }))

    empresaActivaId = 'e-1'
    rerender(<MemoryRouter><DespachoList /></MemoryRouter>)

    await waitFor(() =>
      expect(mocks.listar).toHaveBeenCalledWith({ busqueda: '', estado: null, empresaId: 'e-1', pagina: 1, tamano: 10 }),
    )
    expect(screen.queryByText('Cliente 2')).not.toBeInTheDocument()

    resolver({ filas: [TODAS[0]], total: 1, conteos: normalizarConteos({ armando: 1 }) })
    expect(await screen.findByText('Cliente 1')).toBeInTheDocument()
    expect(screen.queryByText('Cliente 2')).not.toBeInTheDocument()
    // Los conteos también son los de la tienda nueva.
    expect(screen.getByRole('button', { name: 'Sin armar (0)' })).toBeInTheDocument()
  })

  it('al cambiar la empresa activa reencuadra la paginación: una sola consulta, ya en la primera página', async () => {
    mocks.listar.mockImplementation(async ({ empresaId }: { empresaId: string | null }) => {
      const filas = TODAS.filter((f) => !empresaId || f.empresa_id === empresaId)
      return { filas, total: 30, conteos: normalizarConteos(CONTEOS) }
    })
    const { rerender } = abrir()
    expect(await screen.findByText('Cliente 1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente/i }))
    await waitFor(() =>
      expect(mocks.listar).toHaveBeenCalledWith({ busqueda: '', estado: null, empresaId: null, pagina: 2, tamano: 10 }),
    )

    empresaActivaId = 'e-1'
    rerender(<MemoryRouter><DespachoList /></MemoryRouter>)

    await waitFor(() =>
      expect(mocks.listar).toHaveBeenCalledWith({ busqueda: '', estado: null, empresaId: 'e-1', pagina: 1, tamano: 10 }),
    )
    // La consulta de la nueva empresa sale una sola vez: no se pide la página que ya no correspondía.
    const consultasDeLaNuevaEmpresa = mocks.listar.mock.calls.filter(([filtros]) => filtros.empresaId === 'e-1')
    expect(consultasDeLaNuevaEmpresa).toHaveLength(1)
  })
})

// FR-032: la entrada de menú y sus permisos los cubre `destinosPanel.permisos.test.ts`; acá se verifica que la
// ruta de la pantalla está guardada por la sección `ventas` (la misma convención de `App.guard.test.ts`).
describe('ruta de Despacho (F-VTA-17, FR-032)', () => {
  it('la ruta /ventas/despacho exige acceso a la sección ventas', () => {
    const bloque = app.split(/<Route\b/).find((parte) => parte.includes('path="/ventas/despacho"'))
    expect(bloque, 'la ruta /ventas/despacho no está en App.tsx').toBeDefined()
    expect(bloque).toContain('<RequiereAccesoSeccion seccion="ventas">')
  })

  it('el menú de Ventas tiene la entrada «Despacho» que apunta a la pantalla', () => {
    const ventas = SECCIONES_PANEL.find((seccion) => seccion.id === 'ventas')
    const entrada = ventas?.destinos.find((destino) => destino.id === 'ventas-despacho')
    expect(entrada?.etiqueta).toBe('Despacho')
    expect(entrada?.ruta).toBe('/ventas/despacho')
    expect(entrada?.seccionPermiso).toBe('ventas')
    expect(DESTINOS_PANEL.map((destino) => destino.id)).toContain('ventas-despacho')
  })
})
