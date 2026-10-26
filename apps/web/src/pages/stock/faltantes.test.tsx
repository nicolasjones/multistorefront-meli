import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listar: vi.fn(),
  avisar: vi.fn(),
  useNivelSeccion: vi.fn(),
  useFiltroPorEmpresaActiva: vi.fn(),
}))

vi.mock('../../lib/faltantes', async (original) => ({
  ...(await original<typeof import('../../lib/faltantes')>()),
  listarFaltantes: mocks.listar,
  avisarFaltantes: mocks.avisar,
}))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: mocks.useFiltroPorEmpresaActiva }))
vi.mock('../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: { id: 'org-1' } }) }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { FaltantesStock } from './faltantes'

const fila = (n: number, extra: Record<string, unknown> = {}) => ({
  linea_id: `l-${n}`,
  empresa_id: 'e-1',
  empresa: 'San Javucho',
  cliente_id: `c-${n}`,
  cliente: `Cliente ${n}`,
  producto: `Producto ${n}`,
  sku: `SKU-${n}`,
  pedido: n,
  comprobante_id: `f-${n}`,
  comprobante_numero: `A-000${n}`,
  desde: '2026-10-05',
  estado_stock: 'disponible',
  aviso: 'sin_avisar',
  ...extra,
})

const empresas = [{ id: 'e-1', nombre: 'San Javucho' }, { id: 'e-2', nombre: 'Mundo JC' }]

const abrir = () => render(<MemoryRouter><FaltantesStock /></MemoryRouter>)

const matchMediaOriginal = window.matchMedia

// La tabla se condensa en tarjetas por debajo de 900 px: la casilla por fila tiene que
// seguir estando (sin ella no se puede elegir un faltante para avisar).
function mockAnchoPantalla(coincideAngosta: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: coincideAngosta,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

describe('FaltantesStock (F-STK-17)', () => {
  afterEach(() => {
    window.matchMedia = matchMediaOriginal
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.useFiltroPorEmpresaActiva.mockReturnValue({
      empresas, valor: null, cambiar: vi.fn(), empresaActivaId: null, cargando: false, hayError: false,
    })
    mocks.listar.mockResolvedValue({ filas: [fila(1), fila(2, { estado_stock: 'sin_stock', aviso: 'avisado' })], total: 2 })
    mocks.avisar.mockResolvedValue({
      encolados: 1, lineas_avisadas: 1, omitidos_ya_avisados: 0, omitidos_sin_stock: 1, omitidos_sin_correo: 0, omitidos_sin_permiso: 0,
    })
  })

  it('muestra título, subtítulo, pestaña activa, texto de ayuda y las columnas del prototipo', async () => {
    abrir()
    expect(await screen.findByText('Producto 1')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Faltantes', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('Líneas vendidas o pedidas sin stock. Se avisa al cliente cuando el producto vuelve.')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Faltantes', selected: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Todas las tiendas' })).toBeInTheDocument()
    expect(screen.getByText('Por defecto se ven todas; si elegís una empresa en la barra superior, se filtra por esa tienda.')).toBeInTheDocument()
    for (const nombre of ['Seleccionar', 'Tienda', 'Cliente', 'Producto', 'Pedido', 'Comprobante', 'Desde', 'Stock hoy', 'Aviso']) {
      expect(screen.getByRole('columnheader', { name: nombre })).toBeInTheDocument()
    }
  })

  it('muestra la fila con comprobante enlazado, fecha, chips de stock y aviso, sin ids visibles', async () => {
    abrir()
    expect(await screen.findByText('Cliente 1')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'A-0001' })).toHaveAttribute('href', '/ventas/comprobantes/f-1')
    expect(screen.getAllByText('05/10/2026')).toHaveLength(2)
    expect(screen.getByText('Disponible')).toBeInTheDocument()
    expect(screen.getByText('Sin stock')).toBeInTheDocument()
    expect(screen.getByText('Sin avisar')).toBeInTheDocument()
    expect(screen.getByText('Avisado')).toBeInTheDocument()
    expect(screen.queryByText(/\bl-1\b|\bc-1\b/)).not.toBeInTheDocument()
  })

  it('las casillas de filas distintas tienen nombre accesible propio (a11y, T033)', async () => {
    // Mismo producto y mismo cliente en dos comprobantes: las dos casillas se nombran igual y la
    // persona con lector de pantalla no puede saber a qué línea se refiere.
    mocks.listar.mockResolvedValue({
      filas: [
        fila(1, { linea_id: 'l-1', cliente_id: 'c-1', producto: 'Producto 1', cliente: 'Cliente 1', comprobante_numero: 'A-0001' }),
        fila(2, { linea_id: 'l-2', cliente_id: 'c-1', producto: 'Producto 1', cliente: 'Cliente 1', comprobante_numero: 'A-0002' }),
      ],
      total: 2,
    })
    abrir()
    await screen.findAllByText('Producto 1')
    const casillas = screen.getAllByRole('checkbox', { name: /Seleccionar Producto 1 de Cliente 1/ })
    expect(casillas).toHaveLength(2)
    expect(casillas[0]).toHaveAccessibleName('Seleccionar Producto 1 de Cliente 1 del comprobante A-0001')
    expect(casillas[1]).toHaveAccessibleName('Seleccionar Producto 1 de Cliente 1 del comprobante A-0002')
  })

  it('el pie cuenta los seleccionados y trae la frase de cierre; «seleccionar todo» marca las filas', async () => {
    abrir()
    await screen.findByText('Producto 1')
    expect(screen.getByText(/0 seleccionados de 2 faltantes\./)).toBeInTheDocument()
    expect(screen.getByText(/Un faltante se cierra solo cuando se ingresa la mercadería\./)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Seleccionar Producto 1 de Cliente 1 del comprobante A-0001'))
    expect(screen.getByText(/1 seleccionado de 2 faltantes\./)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Seleccionar todo'))
    expect(screen.getByText(/2 seleccionados de 2 faltantes\./)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Seleccionar todo'))
    expect(screen.getByText(/0 seleccionados de 2 faltantes\./)).toBeInTheDocument()
  })

  it('el botón está deshabilitado con 0 y abre el diálogo con el texto del prototipo', async () => {
    abrir()
    await screen.findByText('Producto 1')
    const boton = screen.getByRole('button', { name: 'Avisar a los seleccionados (0)' })
    expect(boton).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Seleccionar todo'))
    fireEvent.click(screen.getByRole('button', { name: 'Avisar a los seleccionados (2)' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Avisar a los clientes' })
    expect(within(dialogo).getByText(
      'Se envía un correo a 2 clientes con el detalle de los productos que volvieron a tener stock. Los faltantes avisados quedan marcados y no se vuelven a avisar.',
    )).toBeInTheDocument()
    expect(within(dialogo).getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.avisar).not.toHaveBeenCalled()
  })

  it('«Enviar avisos» llama a la RPC con las líneas, informa los omitidos y limpia la selección', async () => {
    abrir()
    await screen.findByText('Producto 1')
    fireEvent.click(screen.getByLabelText('Seleccionar todo'))
    fireEvent.click(screen.getByRole('button', { name: 'Avisar a los seleccionados (2)' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar avisos' }))
    await waitFor(() => expect(mocks.avisar).toHaveBeenCalledWith(['l-1', 'l-2']))
    expect(await screen.findByText('Avisos enviados. Se omitieron: 1 sin stock.')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Avisar a los seleccionados (0)' })).toBeDisabled()
    expect(mocks.listar).toHaveBeenCalledTimes(2) // recarga para ver el «Avisado»
  })

  it('sin omitidos el aviso emergente es solo «Avisos enviados»', async () => {
    mocks.avisar.mockResolvedValue({
      encolados: 1, lineas_avisadas: 1, omitidos_ya_avisados: 0, omitidos_sin_stock: 0, omitidos_sin_correo: 0, omitidos_sin_permiso: 0,
    })
    abrir()
    await screen.findByText('Producto 1')
    fireEvent.click(screen.getByLabelText('Seleccionar Producto 1 de Cliente 1 del comprobante A-0001'))
    fireEvent.click(screen.getByRole('button', { name: 'Avisar a los seleccionados (1)' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar avisos' }))
    expect(await screen.findByText('Avisos enviados')).toBeInTheDocument()
  })

  it('un rol sin edición en Ventas ve la lista pero no puede avisar ni seleccionar', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    abrir()
    expect(await screen.findByText('Producto 1')).toBeInTheDocument()
    // La pestaña depende de Stock, no de Ventas: con solo lectura en Ventas sigue visible.
    expect(screen.getByRole('tab', { name: 'Faltantes', selected: true })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Avisar a los seleccionados/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Seleccionar Producto 1 de Cliente 1 del comprobante A-0001')).toBeDisabled()
    expect(screen.queryByLabelText('Seleccionar todo')).not.toBeInTheDocument()
  })

  it('si el aviso falla muestra el error y no limpia la selección', async () => {
    mocks.avisar.mockRejectedValue(new Error('No pudimos enviar los avisos. Probá de nuevo.'))
    abrir()
    await screen.findByText('Producto 1')
    fireEvent.click(screen.getByLabelText('Seleccionar Producto 1 de Cliente 1 del comprobante A-0001'))
    fireEvent.click(screen.getByRole('button', { name: 'Avisar a los seleccionados (1)' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar avisos' }))
    expect(await screen.findByText('No pudimos enviar los avisos. Probá de nuevo.')).toBeInTheDocument()
    // El diálogo sigue abierto (deja el resto oculto a los lectores): la selección se conserva para reintentar.
    expect(screen.getByRole('button', { name: 'Avisar a los seleccionados (1)', hidden: true })).toBeEnabled()
    expect(screen.getByRole('dialog', { name: 'Avisar a los clientes' })).toBeInTheDocument()
  })

  it('sin faltantes muestra «No hay faltantes»', async () => {
    mocks.listar.mockResolvedValue({ filas: [], total: 0 })
    abrir()
    expect(await screen.findByText('No hay faltantes')).toBeInTheDocument()
  })

  it('mientras carga muestra el estado de carga', async () => {
    mocks.listar.mockReturnValue(new Promise(() => undefined))
    abrir()
    expect(await screen.findByLabelText('Cargando contenido')).toBeInTheDocument()
  })

  it('si falla la carga muestra el error y reintenta', async () => {
    mocks.listar.mockRejectedValueOnce(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    abrir()
    expect(await screen.findByText('No pudimos cargar los faltantes.')).toBeInTheDocument()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Reintentar' })))
    expect(await screen.findByText('Producto 1')).toBeInTheDocument()
  })

  it('pide la lista paginada a la base, del más reciente al más antiguo (página 1, todas las tiendas)', async () => {
    abrir()
    await screen.findByText('Producto 1')
    expect(mocks.listar).toHaveBeenCalledWith({ empresaId: null, pagina: 1, tamano: 25 })
  })

  it('en pantalla angosta la casilla por fila sigue disponible para elegir faltantes (T033)', async () => {
    mockAnchoPantalla(true)
    abrir()
    expect(await screen.findByText('Producto 1')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    const casilla = screen.getByLabelText('Seleccionar Producto 1 de Cliente 1 del comprobante A-0001')
    fireEvent.click(casilla)
    expect(screen.getByText(/1 seleccionado de 2 faltantes\./)).toBeInTheDocument()
  })

  it('la pestaña «Faltantes» va antes de «Actualizar por Excel» (T036)', async () => {
    abrir()
    await screen.findByText('Producto 1')
    const pestanas = screen.getAllByRole('tab')
    const indice = (nombre: string) => pestanas.findIndex((pestana) => pestana.textContent === nombre)
    expect(indice('Faltantes')).toBeGreaterThan(-1)
    expect(indice('Faltantes')).toBeLessThan(indice('Actualizar por Excel'))
    expect(pestanas[indice('Faltantes')]).toHaveAttribute('href', '/stock/faltantes')
  })

  it('muestra las filas de la más reciente a la más antigua (FR-303)', async () => {
    mocks.listar.mockResolvedValue({
      filas: [
        fila(1, { linea_id: 'l-1', producto: 'Producto nuevo', desde: '2026-10-09' }),
        fila(2, { linea_id: 'l-2', producto: 'Producto medio', desde: '2026-10-05' }),
        fila(3, { linea_id: 'l-3', producto: 'Producto viejo', desde: '2026-10-01' }),
      ],
      total: 3,
    })
    abrir()
    expect(await screen.findByText('Producto nuevo')).toBeInTheDocument()
    const fechas = screen.getAllByText(/^\d{2}\/\d{2}\/\d{4}$/).map((nodo) => nodo.textContent)
    expect(fechas).toEqual(['09/10/2026', '05/10/2026', '01/10/2026'])
  })

  it('pagina: con más de 25 faltantes, «Siguiente» pide la página 2 (FR-303)', async () => {
    mocks.listar.mockImplementation(async ({ pagina }: { pagina: number }) => ({
      filas: [fila(pagina, { producto: `Producto de la página ${pagina}` })],
      total: 60,
    }))
    abrir()
    expect(await screen.findByText('Producto de la página 1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /next page/i }))
    expect(await screen.findByText('Producto de la página 2')).toBeInTheDocument()
    expect(mocks.listar).toHaveBeenLastCalledWith({ empresaId: null, pagina: 2, tamano: 25 })
  })

  it('tras avisar, la recarga usa los filtros vigentes y no vuelve a la página anterior', async () => {
    mocks.listar.mockImplementation(async ({ pagina }: { pagina: number }) => ({
      filas: [fila(pagina, { producto: `Producto de la página ${pagina}` })],
      total: 60,
    }))
    let resolverAviso: (valor: unknown) => void = () => undefined
    mocks.avisar.mockImplementation(() => new Promise((resuelto) => { resolverAviso = resuelto }))
    abrir()
    expect(await screen.findByText('Producto de la página 1')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Seleccionar Producto de la página 1 de Cliente 1 del comprobante A-0001'))
    fireEvent.click(screen.getByRole('button', { name: 'Avisar a los seleccionados (1)' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar avisos' }))

    // La persona cambia de página mientras el aviso viaja: cuando vuelve, la recarga tiene que
    // pedir la página que está a la vista (nunca la anterior: FR-311, nada de filas viejas).
    fireEvent.click(screen.getByRole('button', { name: /next page/i, hidden: true }))
    expect(await screen.findByText('Producto de la página 2')).toBeInTheDocument()

    resolverAviso({
      encolados: 1, lineas_avisadas: 1, omitidos_ya_avisados: 0, omitidos_sin_stock: 0, omitidos_sin_correo: 0, omitidos_sin_permiso: 0,
    })
    await waitFor(() => expect(mocks.listar).toHaveBeenLastCalledWith({ empresaId: null, pagina: 2, tamano: 25 }))
    expect(screen.getByText('Producto de la página 2')).toBeInTheDocument()
  })

  it('no muestra identificadores técnicos de la fila (FR-310)', async () => {
    mocks.listar.mockResolvedValue({
      filas: [fila(1, {
        linea_id: '7f3c9a51-2b48-4c0d-9f2a-1d5e7b8c9a01',
        comprobante_id: '2c9d5e77-4a10-4b6e-8c3f-9d1a2b3c4d5e',
      })],
      total: 1,
    })
    abrir()
    expect(await screen.findByText('Producto 1')).toBeInTheDocument()
    expect(screen.queryByText(/[0-9a-f]{8}-[0-9a-f]{4}/)).not.toBeInTheDocument()
  })
})
