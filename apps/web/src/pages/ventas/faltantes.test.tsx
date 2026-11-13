import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'

// Test de INTEGRACIÓN de la pantalla: filtros + RPC. Con la suite shardeada el default de 5 s quedaba
// justo y daba falsos rojos. Se sube el timeout del archivo.
vi.setConfig({ testTimeout: 20000 })

const mocks = vi.hoisted(() => ({
  listar: vi.fn(),
  avisar: vi.fn(),
  nivel: { valor: null as 'edicion' | 'lectura' | null },
  useFiltroPorEmpresaActiva: vi.fn(),
  useOrganizacionActiva: vi.fn(),
  cambiarFiltro: vi.fn(),
}))

const imagenes = vi.hoisted(() => ({ mapa: new Map<string, string>() }))
vi.mock('../../hooks/useImagenesProductos', () => ({ useImagenesProductos: () => imagenes.mapa }))

vi.mock('../../lib/ventasFaltantes', async (original) => ({
  ...(await original<typeof import('../../lib/ventasFaltantes')>()),
  listarFaltantes: mocks.listar,
  avisarFaltantesVenta: mocks.avisar,
}))
vi.mock('../../hooks/useNivelSeccion', () => ({
  useNivelSeccion: () => ({ nivel: mocks.nivel.valor, isLoading: false, error: false }),
}))
vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: mocks.useFiltroPorEmpresaActiva }))
vi.mock('../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: mocks.useOrganizacionActiva }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { FaltantesList } from './faltantes'
import app from '../../App.tsx?raw'
import { celular } from '../../test/matchMedia'
import { violacionesAxe } from '../../test/axe'
import { DESTINOS_PANEL, SECCIONES_PANEL } from '../../components/navegacion/destinosPanel'

const fila = (n: number, empresaId: string, empresa: string) => ({
  id: `f-${n}`,
  empresa_id: empresaId,
  empresa,
  cliente: `Cliente ${n}`,
  producto: `Producto ${n}`,
  producto_id: null as string | null,
  sku: `SKU-${n}`,
  cantidad_faltante: 3,
  linea_orden: 1,
  comprobante_id: `comp-${n}`,
  comprobante: `0003-${n}`,
  fecha: '2026-10-01',
  desde: '2026-10-01T10:00:00Z',
  stock_estado: 'disponible' as const,
  stock_disponible: 5,
  aviso: 'sin_avisar' as 'sin_avisar' | 'avisado' | 'para_avisar' | 'en_cola',
  aviso_en: null as string | null,
  aviso_error: null as string | null,
})

// Una fila con otro estado de stock, para probar la columna «Stock hoy» (FR-044).
const filaConStock = (
  n: number,
  stock_estado: 'sin_stock' | 'stock_bajo' | 'disponible' | null,
  stock_disponible: number | null,
) => ({ ...fila(n, 'e-1', 'San Javucho'), stock_estado, stock_disponible })

const TODAS = [fila(1, 'e-1', 'San Javucho'), fila(2, 'e-2', 'Mundo JC')]
const empresas = [{ id: 'e-1', nombre: 'San Javucho' }, { id: 'e-2', nombre: 'Mundo JC' }]

// La empresa activa manda y el filtro de la pantalla la sobreescribe hasta que cambie (como el hook real).
let empresaActivaId: string | null = null

const abrir = () => render(<MemoryRouter><FaltantesList /></MemoryRouter>)

describe('FaltantesList · empresa activa (F-VTA-18, FR-044, FR-046)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.nivel.valor = null
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

  it('muestra la miniatura del producto cuando la fila trae producto_id y no cuando es null', async () => {
    imagenes.mapa = new Map([['p-1', 'https://img/f1.png']])
    mocks.listar.mockResolvedValue({ faltantes: [{ ...fila(1, 'e-1', 'San Javucho'), producto_id: 'p-1' }, fila(2, 'e-1', 'San Javucho')], total: 2 })
    abrir()
    await screen.findByText('Producto 1')
    expect(document.querySelectorAll('img')).toHaveLength(1)
    expect(document.querySelector('img[src="https://img/f1.png"]')).not.toBeNull()
    imagenes.mapa = new Map()
  })

  it('«Cargar más» suma la tanda siguiente y el contador conserva el total (FR-044)', async () => {
    const porPagina = [[fila(1, 'e-1', 'San Javucho'), fila(2, 'e-1', 'San Javucho')], [fila(3, 'e-1', 'San Javucho')]]
    mocks.listar.mockImplementation(async ({ pagina }: { pagina: number }) => ({ faltantes: porPagina[pagina - 1], total: 3 }))
    abrir()
    expect(await screen.findByText('Producto 1')).toBeInTheDocument()
    expect(screen.getByText('3 faltantes')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /next page|siguiente/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
    expect(await screen.findByText('Producto 3')).toBeInTheDocument()
    expect(screen.getByText('Producto 1')).toBeInTheDocument()
    expect(await screen.findByText('No hay más resultados.')).toBeInTheDocument()
  })

  it('cambiar de tienda reinicia desde la primera tanda', async () => {
    mocks.listar.mockImplementation(async ({ empresaId, pagina }: { empresaId: string | null; pagina: number }) => {
      if (empresaId) return { faltantes: [fila(9, 'e-1', 'San Javucho')], total: 1 }
      return { faltantes: [pagina === 1 ? fila(1, 'e-1', 'San Javucho') : fila(3, 'e-1', 'San Javucho')], total: 2 }
    })
    const { rerender } = abrir()
    await screen.findByText('Producto 1')
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
    await screen.findByText('Producto 3')
    empresaActivaId = 'e-1'
    rerender(<MemoryRouter><FaltantesList /></MemoryRouter>)
    expect(await screen.findByText('Producto 9')).toBeInTheDocument()
    expect(screen.queryByText('Producto 1')).not.toBeInTheDocument()
    expect(screen.queryByText('Producto 3')).not.toBeInTheDocument()
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

  it('al cambiar la empresa activa reinicia la carga infinita: una sola consulta, ya en la primera tanda', async () => {
    // Con muchas filas hay varias páginas: se pide la segunda.
    mocks.listar.mockImplementation(async ({ empresaId }: { empresaId: string | null }) => {
      const filas = TODAS.filter((f) => !empresaId || f.empresa_id === empresaId)
      return { faltantes: filas, total: 30 }
    })
    const { rerender } = abrir()
    expect(await screen.findByText('Producto 1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
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

  it('rotula el estado del stock de hoy y las unidades disponibles de cada producto (FR-044)', async () => {
    mocks.listar.mockResolvedValue({
      faltantes: [filaConStock(1, 'sin_stock', 0), filaConStock(2, 'stock_bajo', 1), filaConStock(3, null, null)],
      total: 3,
    })
    abrir()

    expect(await screen.findByText('Sin stock')).toBeInTheDocument()
    expect(screen.getByText('Stock bajo')).toBeInTheDocument()
    // Sin dato de stock no se inventa una etiqueta: se dice que no se sabe.
    expect(screen.getByText('Sin dato')).toBeInTheDocument()
    // La unidad va en singular o plural.
    expect(screen.getByText('0 unidades')).toBeInTheDocument()
    expect(screen.getByText('1 unidad')).toBeInTheDocument()
  })

  it('muestra en «Desde» la fecha en que se registró el faltante (FR-044)', async () => {
    abrir()
    expect(await screen.findByText('Producto 1')).toBeInTheDocument()
    // La fecha va con día/mes/año (el formato del kit); no importa la zona horaria del runner.
    expect(screen.getAllByText(/\d{1,2}\/\d{1,2}\/\d{4}/).length).toBeGreaterThan(0)
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

    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
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
    mocks.nivel.valor = null
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

  it('el menú de Ventas tiene la entrada «Faltantes» que apunta a la pantalla', () => {
    const ventas = SECCIONES_PANEL.find((seccion) => seccion.id === 'ventas')
    const entrada = ventas?.destinos.find((destino) => destino.id === 'ventas-faltantes')
    expect(entrada?.etiqueta).toBe('Faltantes')
    expect(entrada?.ruta).toBe('/ventas/faltantes')
    expect(entrada?.seccionPermiso).toBe('ventas')
    // Y es un destino del panel (aparece en el menú junto a los demás).
    expect(DESTINOS_PANEL.map((destino) => destino.id)).toContain('ventas-faltantes')
  })
})


// ---------------------------------------------------------------------------------------------------------
// F-VTA-26 · Avisar a los clientes (FR-002, FR-003, FR-005) y F-VTA-27 · «Para avisar» (FR-104)
// ---------------------------------------------------------------------------------------------------------

const resultadoAviso = (cambios: Record<string, unknown> = {}) => ({
  encolados: 2,
  lineas_avisadas: 2,
  omitidos_ya_avisados: 0,
  omitidos_en_cola: 0,
  omitidos_sin_correo: 0,
  omitidos_sin_permiso: 0,
  omitidos_no_abiertos: 0,
  omitidos_reaviso_reciente: 0,
  omitidos_tope_diario: 0,
  detalle: [],
  ...cambios,
})

const boton = (nombre: string | RegExp) => screen.getByRole('button', { name: nombre })

function prepararAvisos(nivel: 'edicion' | 'lectura' | null = 'edicion') {
  vi.clearAllMocks()
  mocks.nivel.valor = nivel
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
  mocks.listar.mockImplementation(async ({ empresaId, aviso }: { empresaId: string | null; aviso?: string | null }) => {
    const filas = TODAS.filter((f) => (!empresaId || f.empresa_id === empresaId) && (!aviso || f.aviso === aviso))
    return { faltantes: filas, total: filas.length }
  })
  mocks.avisar.mockResolvedValue(resultadoAviso())
}

describe('FaltantesList · avisar a los clientes (F-VTA-26, FR-002, FR-003, FR-005)', () => {
  beforeEach(() => prepararAvisos('edicion'))
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
  })

  it('con ventas en edición ofrece casillas, «seleccionar todo», el pie y el botón deshabilitado con 0', async () => {
    abrir()
    await screen.findByText('Producto 1')
    expect(boton('Avisar a los seleccionados (0)')).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Seleccionar todos' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Seleccionar Producto 1 de Cliente 1 del comprobante 0003-1' })).toBeInTheDocument()
    expect(screen.getByText('0 seleccionados de 2 faltantes.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Producto 1 de Cliente 1 del comprobante 0003-1' }))
    expect(boton('Avisar a los seleccionados (1)')).toBeEnabled()
    expect(screen.getByText('1 seleccionado de 2 faltantes.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos' }))
    expect(boton('Avisar a los seleccionados (2)')).toBeEnabled()
    expect(screen.getByText('2 seleccionados de 2 faltantes.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos' }))
    expect(boton('Avisar a los seleccionados (0)')).toBeDisabled()
  })

  it('con más de 200 seleccionados «Avisar» queda deshabilitado y dice cuántos desmarcar', async () => {
    const muchas = Array.from({ length: 201 }, (_, i) => fila(i + 1, 'e-1', 'San Javucho'))
    mocks.listar.mockResolvedValue({ faltantes: muchas, total: 201 })
    abrir()
    await screen.findByText('Producto 1')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos' }))
    expect(boton('Avisar a los seleccionados (201)')).toBeDisabled()
    expect(screen.getByText(/Se avisa de a 200 por vez: desmarcá 1 para poder enviar\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Producto 1 de Cliente 1 del comprobante 0003-1' }))
    expect(boton('Avisar a los seleccionados (200)')).toBeEnabled()
  })

  it('con lectura no hay casillas ni botón de avisar', async () => {
    mocks.nivel.valor = 'lectura'
    abrir()
    await screen.findByText('Producto 1')
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Avisar a los seleccionados/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/seleccionados de/)).not.toBeInTheDocument()
  })

  it('muestra la columna Aviso con «Sin avisar», «Para avisar» y «Avisado» con su fecha', async () => {
    mocks.listar.mockResolvedValue({
      faltantes: [
        { ...fila(1, 'e-1', 'San Javucho'), aviso: 'sin_avisar' },
        { ...fila(2, 'e-1', 'San Javucho'), aviso: 'para_avisar', aviso_en: '2026-10-08T12:00:00Z' },
        { ...fila(3, 'e-1', 'San Javucho'), aviso: 'avisado', aviso_en: '2026-10-09T15:30:00Z' },
      ],
      total: 3,
    })
    abrir()
    await screen.findByText('Producto 1')
    expect(screen.getAllByText('Aviso').length).toBeGreaterThan(0)
    expect(screen.getByText('Sin avisar')).toBeInTheDocument()
    expect(screen.getByText('Para avisar', { selector: '.MuiChip-label' })).toBeInTheDocument()
    expect(screen.getByText('Avisado · 09/10/2026')).toBeInTheDocument()
  })

  it('«En cola» no es «Avisado», y un aviso fallido muestra el chip con el motivo y «Reintentar» (M-1, QA M5)', async () => {
    mocks.listar.mockResolvedValue({
      faltantes: [
        { ...fila(1, 'e-1', 'San Javucho'), aviso: 'en_cola', aviso_en: '2026-10-09T15:30:00Z' },
        { ...fila(2, 'e-1', 'San Javucho'), aviso: 'para_avisar', aviso_en: '2026-10-08T12:00:00Z', aviso_error: 'smtp_conexion' },
      ],
      total: 2,
    })
    abrir()
    await screen.findByText('Producto 1')
    expect(screen.getByText('En cola', { selector: '.MuiChip-label' })).toBeInTheDocument()
    expect(screen.queryByText(/Avisado/)).not.toBeInTheDocument()
    expect(screen.getByText('Aviso fallido')).toBeInTheDocument()
    expect(screen.getByText('No se pudo avisar: no se pudo conectar con el servidor de correo.')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Reintentar el aviso/ })).toHaveLength(1)

    // «Reintentar» elige solo ese faltante y abre el diálogo.
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar el aviso de Producto 2 a Cliente 2' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Avisar a los clientes' })
    expect(within(dialogo).getByText(/Se envía un correo a 1 cliente /)).toBeInTheDocument()
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Enviar avisos' }))
    await waitFor(() => expect(mocks.avisar).toHaveBeenCalledWith(['f-2'], 'Volvió a haber stock de los productos que tenías pedidos:', false))
  })

  it('sin permiso de edición el aviso fallido se ve pero no trae «Reintentar»', async () => {
    prepararAvisos('lectura')
    mocks.listar.mockResolvedValue({
      faltantes: [{ ...fila(1, 'e-1', 'San Javucho'), aviso_error: 'otro' }],
      total: 1,
    })
    abrir()
    await screen.findByText('Aviso fallido')
    expect(screen.queryByRole('button', { name: /Reintentar/ })).not.toBeInTheDocument()
  })

  it('al cambiar de filtro la selección se descarta: «Avisar (n)» solo cuenta lo que se ve (m-7, QA M4)', async () => {
    mocks.listar.mockImplementation(async ({ aviso }: { aviso?: string | null }) => {
      const filas = [
        { ...fila(1, 'e-1', 'San Javucho'), aviso: 'sin_avisar' as const },
        { ...fila(2, 'e-1', 'San Javucho'), aviso: 'para_avisar' as const, aviso_en: '2026-10-08T12:00:00Z' },
      ].filter((f) => !aviso || f.aviso === aviso)
      return { faltantes: filas, total: filas.length }
    })
    abrir()
    await screen.findByText('Producto 1')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos' }))
    expect(boton('Avisar a los seleccionados (2)')).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Para avisar' }))
    await waitFor(() => expect(screen.queryByText('Producto 1')).not.toBeInTheDocument())
    expect(boton('Avisar a los seleccionados (0)')).toBeDisabled()

    // Y al volver a «Todos» tampoco reaparece la selección anterior.
    fireEvent.click(screen.getByRole('button', { name: 'Todos' }))
    await screen.findByText('Producto 1')
    expect(boton('Avisar a los seleccionados (0)')).toBeDisabled()
  })

  it('el texto del aviso se cuenta por caracteres, no se recorta al tipear y se recorta al salir del campo y al enviar (PR #926 m-3)', async () => {
    abrir()
    await screen.findByText('Producto 1')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos' }))
    fireEvent.click(boton(/Avisar a los seleccionados/))
    const dialogo = await screen.findByRole('dialog', { name: 'Avisar a los clientes' })
    const texto = within(dialogo).getByRole('textbox', { name: 'Texto del aviso' }) as HTMLTextAreaElement
    // 600 emojis son 1.200 unidades UTF-16 pero 600 caracteres: el contador los cuenta bien y el campo no tiene maxLength.
    fireEvent.change(texto, { target: { value: '😀'.repeat(600) } })
    expect(within(dialogo).getByText('600 / 1000')).toBeInTheDocument()
    expect(texto).not.toHaveAttribute('maxlength')
    expect(texto).not.toHaveAttribute('aria-invalid', 'true')
    // Pasado el tope NO se recorta mientras se tipea (el cursor no salta ni se interfiere con la composición): el contador avisa.
    fireEvent.change(texto, { target: { value: '😀'.repeat(1200) } })
    expect(Array.from(texto.value)).toHaveLength(1200)
    expect(within(dialogo).getByText('1200 / 1000')).toBeInTheDocument()
    expect(texto).toHaveAttribute('aria-invalid', 'true')
    // Al salir del campo se recorta a 1.000 caracteres.
    fireEvent.blur(texto)
    expect(Array.from(texto.value)).toHaveLength(1000)
    expect(within(dialogo).getByText('1000 / 1000')).toBeInTheDocument()
    expect(texto).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('al enviar con el texto pasado del tope (sin haber salido del campo) se manda recortado a 1.000 caracteres (PR #926 m-3)', async () => {
    abrir()
    await screen.findByText('Producto 1')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos' }))
    fireEvent.click(boton(/Avisar a los seleccionados/))
    const dialogo = await screen.findByRole('dialog', { name: 'Avisar a los clientes' })
    fireEvent.change(within(dialogo).getByRole('textbox', { name: 'Texto del aviso' }), { target: { value: '😀'.repeat(1200) } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Enviar avisos' }))
    await waitFor(() => expect(mocks.avisar).toHaveBeenCalled())
    const texto = mocks.avisar.mock.calls[0][1] as string
    expect(Array.from(texto)).toHaveLength(1000)
  })

  it('el diálogo trae el texto editable, cuenta los clientes y envía el texto editado', async () => {
    mocks.listar.mockResolvedValue({
      faltantes: [
        fila(1, 'e-1', 'San Javucho'),
        { ...fila(2, 'e-1', 'San Javucho'), cliente: 'Cliente 1' },
        fila(3, 'e-1', 'San Javucho'),
      ],
      total: 3,
    })
    abrir()
    await screen.findByText('Producto 3')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos' }))
    fireEvent.click(boton('Avisar a los seleccionados (3)'))

    const dialogo = await screen.findByRole('dialog', { name: 'Avisar a los clientes' })
    // Tres faltantes de dos clientes: el correo es uno por cliente.
    expect(within(dialogo).getByText(/Se envía un correo a 2 clientes/)).toBeInTheDocument()
    const texto = within(dialogo).getByRole('textbox', { name: 'Texto del aviso' })
    expect(texto).toHaveValue('Volvió a haber stock de los productos que tenías pedidos:')
    expect(within(dialogo).getByText('57 / 1000')).toBeInTheDocument()
    // Sin avisados no se pide confirmar ningún reaviso.
    expect(within(dialogo).queryByRole('checkbox')).not.toBeInTheDocument()

    fireEvent.change(texto, { target: { value: 'Ya llegó lo que pediste' } })
    expect(within(dialogo).getByText('23 / 1000')).toBeInTheDocument()
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Enviar avisos' }))

    await waitFor(() =>
      expect(mocks.avisar).toHaveBeenCalledWith(expect.arrayContaining(['f-1', 'f-2', 'f-3']), 'Ya llegó lo que pediste', false),
    )
    expect(await screen.findByText('Avisos en cola.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // La lista se recarga y la selección se descarta.
    expect(mocks.listar.mock.calls.length).toBeGreaterThan(1)
    expect(boton('Avisar a los seleccionados (0)')).toBeDisabled()
  })

  it('con faltantes ya avisados pide confirmar el reaviso y lo manda con la confirmación', async () => {
    mocks.listar.mockResolvedValue({
      faltantes: [{ ...fila(1, 'e-1', 'San Javucho'), aviso: 'avisado', aviso_en: '2026-10-09T15:30:00Z' }, fila(2, 'e-1', 'San Javucho')],
      total: 2,
    })
    abrir()
    await screen.findByText('Producto 1')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos' }))
    fireEvent.click(boton('Avisar a los seleccionados (2)'))
    const dialogo = await screen.findByRole('dialog', { name: 'Avisar a los clientes' })
    const reavisar = within(dialogo).getByRole('checkbox', { name: 'Volver a avisar a los 1 ya avisados' })
    expect(reavisar).not.toBeChecked()
    fireEvent.click(reavisar)
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Enviar avisos' }))
    await waitFor(() => expect(mocks.avisar).toHaveBeenCalledWith(expect.any(Array), expect.any(String), true))
  })

  it('«Cancelar» cierra el diálogo sin enviar y la selección queda', async () => {
    abrir()
    await screen.findByText('Producto 1')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos' }))
    fireEvent.click(boton('Avisar a los seleccionados (2)'))
    const dialogo = await screen.findByRole('dialog', { name: 'Avisar a los clientes' })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.avisar).not.toHaveBeenCalled()
    expect(boton('Avisar a los seleccionados (2)')).toBeEnabled()
  })

  it('avisa lo omitido y por qué, y sin correo no es un éxito: «El cliente no tiene correo»', async () => {
    mocks.avisar.mockResolvedValue(
      resultadoAviso({ encolados: 0, lineas_avisadas: 0, omitidos_sin_correo: 1, detalle: [{ id: 'f-1', resultado: 'sin_correo' }] }),
    )
    abrir()
    await screen.findByText('Producto 1')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Producto 1 de Cliente 1 del comprobante 0003-1' }))
    fireEvent.click(boton('Avisar a los seleccionados (1)'))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Enviar avisos' }))
    expect(await screen.findByText('No se enviaron avisos. El cliente no tiene correo: Cliente 1.')).toBeInTheDocument()
  })

  it('si el aviso salió pero falla la recarga, lo dice y la lista muestra el error (no queda la vieja)', async () => {
    mocks.avisar.mockResolvedValue(resultadoAviso({ encolados: 1, lineas_avisadas: 1 }))
    abrir()
    await screen.findByText('Producto 1')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Producto 1 de Cliente 1 del comprobante 0003-1' }))
    fireEvent.click(boton('Avisar a los seleccionados (1)'))
    mocks.listar.mockRejectedValue(new Error('red'))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Enviar avisos' }))
    expect(await screen.findByText('Avisos en cola.')).toBeInTheDocument()
    expect(await screen.findByText('No pudimos cargar los faltantes.')).toBeInTheDocument()
    expect(screen.queryByText('Producto 1')).not.toBeInTheDocument()
  })

  it('«Enviar avisos» queda deshabilitado mientras envía: un doble clic no duplica el envío', async () => {
    let resolver: (v: unknown) => void = () => {}
    mocks.avisar.mockImplementation(() => new Promise((r) => { resolver = r }))
    abrir()
    await screen.findByText('Producto 1')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos' }))
    fireEvent.click(boton('Avisar a los seleccionados (2)'))
    const dialogo = await screen.findByRole('dialog')
    const enviar = within(dialogo).getByRole('button', { name: 'Enviar avisos' })
    fireEvent.click(enviar)
    fireEvent.click(enviar)
    expect(mocks.avisar).toHaveBeenCalledTimes(1)
    expect(enviar).toBeDisabled()
    expect(within(dialogo).getByRole('button', { name: 'Cancelar' })).toBeDisabled()
    await act(async () => { resolver(resultadoAviso()) })
    expect(await screen.findByText('Avisos en cola.')).toBeInTheDocument()
  })

  it('si el envío falla muestra el error en castellano, no cierra el diálogo y deja reintentar', async () => {
    mocks.avisar.mockRejectedValueOnce(new Error('Tu rol no puede avisar faltantes.'))
    abrir()
    await screen.findByText('Producto 1')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos' }))
    fireEvent.click(boton('Avisar a los seleccionados (2)'))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Enviar avisos' }))
    expect(await screen.findByText('Tu rol no puede avisar faltantes.')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await waitFor(() => expect(within(dialogo).getByRole('button', { name: 'Enviar avisos' })).toBeEnabled())
  })

  it('no muestra identificadores técnicos (UUID) en la pantalla', async () => {
    mocks.listar.mockResolvedValue({
      faltantes: [{ ...fila(1, 'e-1', 'San Javucho'), id: '3f2c9a1e-5b7d-4c8e-9a10-2b3c4d5e6f70' }],
      total: 1,
    })
    abrir()
    await screen.findByText('Producto 1')
    expect(document.body.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)
  })
})

describe('FaltantesList · «Para avisar» (F-VTA-27, FR-104)', () => {
  beforeEach(() => prepararAvisos('edicion'))

  const conMarcados = () => {
    const marcados = [
      { ...fila(1, 'e-1', 'San Javucho'), aviso: 'para_avisar' as const, aviso_en: '2026-10-08T12:00:00Z' },
      { ...fila(2, 'e-2', 'Mundo JC'), aviso: 'para_avisar' as const, aviso_en: '2026-10-09T12:00:00Z' },
    ]
    mocks.listar.mockImplementation(async ({ empresaId, aviso }: { empresaId: string | null; aviso?: string | null }) => {
      const base = [...marcados, { ...fila(3, 'e-1', 'San Javucho'), aviso: 'sin_avisar' as const }]
      const filas = base.filter((f) => (!empresaId || f.empresa_id === empresaId) && (!aviso || f.aviso === aviso))
      return { faltantes: filas, total: filas.length }
    })
  }

  it('el filtro «Para avisar» pide solo los marcados, con la nota informativa, y «Todos» vuelve a la lista completa', async () => {
    conMarcados()
    abrir()
    await screen.findByText('Producto 3')
    expect(screen.queryByRole('note')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Para avisar' }))
    await waitFor(() => expect(mocks.listar).toHaveBeenCalledWith({ empresaId: null, pagina: 1, tamano: 10, aviso: 'para_avisar' }))
    expect(await screen.findByText('Producto 1')).toBeInTheDocument()
    expect(screen.getByText('Producto 2')).toBeInTheDocument()
    expect(screen.queryByText('Producto 3')).not.toBeInTheDocument()
    expect(screen.getByText('2 faltantes')).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent(/No se envía nada solo/)
    expect(screen.getAllByText('Para avisar', { selector: '.MuiChip-label' })).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Todos' }))
    expect(await screen.findByText('Producto 3')).toBeInTheDocument()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('respeta el orden de la base (más antiguo primero) y la empresa activa', async () => {
    conMarcados()
    abrir()
    await screen.findByText('Producto 3')
    fireEvent.click(screen.getByRole('button', { name: 'Para avisar' }))
    await screen.findByText('Producto 2')
    const celdas = screen.getAllByText(/^Producto \d$/).map((e) => e.textContent)
    expect(celdas).toEqual(['Producto 1', 'Producto 2'])
  })

  it('con el filtro «Para avisar» y una empresa activa pide solo esa tienda', async () => {
    conMarcados()
    empresaActivaId = 'e-2'
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Para avisar' }))
    await waitFor(() => expect(mocks.listar).toHaveBeenCalledWith({ empresaId: 'e-2', pagina: 1, tamano: 10, aviso: 'para_avisar' }))
    expect(await screen.findByText('Producto 2')).toBeInTheDocument()
    expect(screen.queryByText('Producto 1')).not.toBeInTheDocument()
  })

  it('sin marcados muestra «No hay faltantes para avisar»', async () => {
    mocks.listar.mockImplementation(async ({ aviso }: { aviso?: string | null }) =>
      aviso ? { faltantes: [], total: 0 } : { faltantes: [TODAS[0]], total: 1 })
    abrir()
    await screen.findByText('Producto 1')
    fireEvent.click(screen.getByRole('button', { name: 'Para avisar' }))
    expect(await screen.findByText('No hay faltantes para avisar')).toBeInTheDocument()
    expect(screen.queryByText('Sin resultados')).not.toBeInTheDocument()
  })

  it('se puede elegir y avisar desde la vista «Para avisar»', async () => {
    conMarcados()
    abrir()
    await screen.findByText('Producto 3')
    fireEvent.click(screen.getByRole('button', { name: 'Para avisar' }))
    await screen.findByText('Producto 2')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos' }))
    fireEvent.click(boton('Avisar a los seleccionados (2)'))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Enviar avisos' }))
    await waitFor(() => expect(mocks.avisar).toHaveBeenCalledWith(expect.arrayContaining(['f-1', 'f-2']), expect.any(String), false))
  })
})

// SC-001 · a11y: axe sin violaciones a 320, 768 y 1440 px (en jsdom el ancho se simula con matchMedia: tarjetas
// por debajo de 600 px, tabla desde ahí), con el diálogo abierto y con el filtro «Para avisar».
describe('FaltantesList · accesibilidad (F-VTA-26 y F-VTA-27, SC-001, SC-101)', () => {
  beforeEach(() => prepararAvisos('edicion'))
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
  })

  for (const ancho of [320, 768, 1440]) {
    it(`sin violaciones de axe a ${ancho} px (lista, diálogo y «Para avisar»)`, async () => {
      celular(ancho < 600)
      mocks.listar.mockImplementation(async ({ aviso }: { aviso?: string | null }) => {
        const filas = [
          { ...fila(1, 'e-1', 'San Javucho'), aviso: 'para_avisar' as const, aviso_en: '2026-10-08T12:00:00Z' },
          { ...fila(2, 'e-2', 'Mundo JC'), aviso: 'avisado' as const, aviso_en: '2026-10-09T12:00:00Z' },
        ].filter((f) => !aviso || f.aviso === aviso)
        return { faltantes: filas, total: filas.length }
      })
      abrir()
      await screen.findByText('Producto 1')
      expect(await violacionesAxe(document.body)).toEqual([])

      fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos' }))
      fireEvent.click(boton('Avisar a los seleccionados (2)'))
      await screen.findByRole('dialog', { name: 'Avisar a los clientes' })
      expect(await violacionesAxe(document.body)).toEqual([])
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

      fireEvent.click(screen.getByRole('button', { name: 'Para avisar' }))
      await waitFor(() => expect(screen.queryByText('Producto 2')).not.toBeInTheDocument())
      expect(screen.getByRole('note')).toBeInTheDocument()
      expect(await violacionesAxe(document.body)).toEqual([])
    })
  }
})
