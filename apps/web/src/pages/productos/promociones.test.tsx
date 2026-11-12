import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  leerPromociones: vi.fn(),
  guardarPromocion: vi.fn(),
  anularPromocion: vi.fn(),
  buscarProductos: vi.fn(),
  buscadorCatalogo: vi.fn(),
  useNivelSeccion: vi.fn(),
  useEmpresasAccesibles: vi.fn(),
  useOrganizacionActiva: vi.fn(),
  useCapacidadesPrecios: vi.fn(),
}))

vi.mock('../../lib/promociones', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/promociones')>()
  return {
    ...actual,
    leerPromociones: mocks.leerPromociones,
    guardarPromocion: mocks.guardarPromocion,
    anularPromocion: mocks.anularPromocion,
  }
})
vi.mock('../../hooks/useBuscadorCatalogo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/useBuscadorCatalogo')>()),
  useBuscadorCatalogo: mocks.buscadorCatalogo,
}))
vi.mock('../../lib/supabase', () => ({ supabaseClient: {} }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: mocks.useEmpresasAccesibles }))
vi.mock('../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: mocks.useOrganizacionActiva }))
vi.mock('../../hooks/useCapacidadesPrecios', () => ({ useCapacidadesPrecios: mocks.useCapacidadesPrecios }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { PromocionesList } from './promociones'

const EMPRESAS = [
  { id: 'e1', nombre: 'Tienda A', esActiva: false },
  { id: 'e2', nombre: 'Tienda B', esActiva: false },
]

const accesibles = (activa: string | null) => ({
  empresas: EMPRESAS.map((e) => ({ ...e, esActiva: e.id === activa })),
  empresaActivaId: activa,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
})

const promo = (cambios: Record<string, unknown>) => ({
  id: 'p1', empresaId: 'e1', empresaNombre: 'Tienda A', productoId: 'a1', productoNombre: 'Alfa', productoSku: 'PR-1',
  precioPromocional: 800, desde: '2030-11-10T12:00:00Z', hasta: '2030-11-12T12:00:00Z', estado: 'programada',
  precioNormal: 1331, precioVigente: 1331, actualizadoEn: '2026-11-07T10:00:00.123456+00:00', ...cambios,
})

const DE_A = [
  promo({ id: 'pa-prog', productoNombre: 'Alfa de A', estado: 'programada' }),
  promo({ id: 'pa-vig', productoNombre: 'Beta de A', productoId: 'a2', estado: 'vigente', precioVigente: 800 }),
  promo({ id: 'pa-venc', productoNombre: 'Gama de A', productoId: 'a3', estado: 'vencida' }),
  promo({ id: 'pa-anul', productoNombre: 'Delta de A', productoId: 'a4', estado: 'anulada' }),
]
const DE_B = [promo({ id: 'pb-1', empresaId: 'e2', empresaNombre: 'Tienda B', productoNombre: 'Solo de B', productoId: 'b1', estado: 'vigente' })]

const PRODUCTOS = [
  { id: 'a1', nombre: 'Alfa', sku: 'PR-1' },
  { id: 'a2', nombre: 'Beta', sku: 'PR-2' },
]

const capacidades = (promociones: boolean, niveles: Record<string, string> = { e1: 'edicion', e2: 'edicion' }, hayError = false) =>
  mocks.useCapacidadesPrecios.mockReturnValue({
    capacidades: { promociones, preciosMasivos: true, edicionEnTodasLasTiendas: true, nivelesProductos: niveles },
    cargando: false,
    hayError,
  })

const abrir = () => render(<PromocionesList />)

describe('PromocionesList (F-PRE-11, FR-016 · SC-005)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.leerPromociones.mockImplementation(async (_cliente: unknown, empresaId: string | null) =>
      empresaId === 'e1' ? DE_A : empresaId === 'e2' ? DE_B : [...DE_A, ...DE_B],
    )
    mocks.guardarPromocion.mockResolvedValue(undefined)
    mocks.anularPromocion.mockResolvedValue(undefined)
    mocks.buscadorCatalogo.mockReturnValue({ opciones: PRODUCTOS, truncado: false, error: false, cargando: false, buscar: mocks.buscarProductos })
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.useEmpresasAccesibles.mockReturnValue(accesibles('e1'))
    mocks.useOrganizacionActiva.mockReturnValue({ organizacionActiva: { id: 'o1' }, isLoading: false })
    capacidades(true)
  })

  it('lista producto, precios, fechas y estado derivado de la empresa activa', async () => {
    abrir()
    expect(await screen.findByText('Alfa de A')).toBeInTheDocument()
    expect(mocks.leerPromociones).toHaveBeenCalledWith({}, 'e1')
    expect(screen.getByRole('heading', { name: 'Promociones' })).toBeInTheDocument()
    for (const columna of ['Producto', 'Precio normal', 'Precio promocional', 'Desde', 'Hasta', 'Estado']) {
      expect(screen.getAllByText(columna).length).toBeGreaterThan(0)
    }
    expect(screen.queryByRole('columnheader', { name: 'Empresa' })).toBeNull()
    expect(screen.getByText('Programada')).toBeInTheDocument()
    expect(screen.getByText('Vigente')).toBeInTheDocument()
    expect(screen.getByText('Vencida')).toBeInTheDocument()
    expect(screen.getByText('Anulada')).toBeInTheDocument()
    expect(screen.getByText('4 promociones · Tienda A')).toBeInTheDocument()
  })

  it('Editar y Anular solo en promociones programadas o vigentes', async () => {
    abrir()
    await screen.findByText('Alfa de A')
    expect(screen.getByRole('button', { name: 'Editar la promoción de Alfa de A' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Anular la promoción de Beta de A' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Editar la promoción de Gama de A' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Anular la promoción de Delta de A' })).toBeNull()
  })

  it('«Nueva promoción»: valida, guarda para la empresa activa y recarga', async () => {
    abrir()
    await screen.findByText('Alfa de A')
    fireEvent.click(screen.getByRole('button', { name: 'Nueva promoción' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Nueva promoción' })
    expect(within(dialogo).getByLabelText('Empresa')).toHaveValue('Tienda A')
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    expect(await within(dialogo).findByText('Elegí un producto')).toBeInTheDocument()
    expect(within(dialogo).getByText('Ingresá un precio mayor a 0')).toBeInTheDocument()
    expect(mocks.guardarPromocion).not.toHaveBeenCalled()

    fireEvent.change(within(dialogo).getByLabelText(/Producto/), { target: { value: 'Alfa' } })
    fireEvent.keyDown(within(dialogo).getByLabelText(/Producto/), { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('option', { name: /Alfa · PR-1/ }))
    fireEvent.change(within(dialogo).getByLabelText(/Precio promocional/), { target: { value: '700' } })
    fireEvent.change(within(dialogo).getByLabelText(/Desde/), { target: { value: '2030-11-10T09:00' } })
    fireEvent.change(within(dialogo).getByLabelText(/Hasta/), { target: { value: '2030-11-12T09:00' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mocks.guardarPromocion).toHaveBeenCalledTimes(1))
    expect(mocks.guardarPromocion.mock.calls[0][1]).toMatchObject({ id: null, empresaId: 'e1', productoId: 'a1', precioTexto: '700' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByText('Promoción programada.')).toBeInTheDocument()
    expect(mocks.leerPromociones.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('el selector de productos busca en el servidor al escribir y avisa si el catálogo se cortó', async () => {
    mocks.buscadorCatalogo.mockReturnValue({ opciones: PRODUCTOS, truncado: true, error: false, cargando: false, buscar: mocks.buscarProductos })
    abrir()
    await screen.findByText('Alfa de A')
    fireEvent.click(screen.getByRole('button', { name: 'Nueva promoción' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Nueva promoción' })
    fireEvent.change(within(dialogo).getByLabelText(/Producto/), { target: { value: 'pila' } })
    expect(mocks.buscarProductos).toHaveBeenCalledWith('pila')
    expect(mocks.buscadorCatalogo).toHaveBeenCalledWith(expect.objectContaining({ tabla: 'productos', columnasBusqueda: 'nombre,sku', soloActivos: true }))
    expect(within(dialogo).getByText(/Hay más de 500 productos: escribí para buscar/)).toBeInTheDocument()
  })

  it('muestra el error de solape de la base sin cerrar el diálogo', async () => {
    mocks.guardarPromocion.mockRejectedValue({ code: '23P01', message: 'solape' })
    abrir()
    await screen.findByText('Alfa de A')
    fireEvent.click(screen.getByRole('button', { name: 'Editar la promoción de Alfa de A' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Editar promoción' })
    expect(within(dialogo).getByLabelText(/Precio promocional/)).toHaveValue('800')
    expect(within(dialogo).getByLabelText(/Producto/)).toBeDisabled()
    fireEvent.change(within(dialogo).getByLabelText(/Precio promocional/), { target: { value: '750' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    expect(await within(dialogo).findByText(/se solapa con esas fechas/)).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Editar promoción' })).toBeInTheDocument()
    // Edita con el updated_at que leyó (control de concurrencia).
    expect(mocks.guardarPromocion.mock.calls[0][1]).toMatchObject({ id: 'pa-prog', actualizadoEn: '2026-11-07T10:00:00.123456+00:00' })
  })

  it('«Anular» pide confirmación y anula con el updated_at leído', async () => {
    abrir()
    await screen.findByText('Alfa de A')
    fireEvent.click(screen.getByRole('button', { name: 'Anular la promoción de Beta de A' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Anular promoción' })
    expect(within(dialogo).getByText(/Deja de regir de inmediato/)).toBeInTheDocument()
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Anular promoción' }))
    await waitFor(() => expect(mocks.anularPromocion).toHaveBeenCalledTimes(1))
    expect(mocks.anularPromocion.mock.calls[0][1]).toMatchObject({ id: 'pa-vig', actualizadoEn: '2026-11-07T10:00:00.123456+00:00' })
    expect(await screen.findByText('Promoción anulada.')).toBeInTheDocument()
  })

  it('«Todas mis empresas»: lista todas con columna Empresa y el alta queda deshabilitada', async () => {
    mocks.useEmpresasAccesibles.mockReturnValue(accesibles(null))
    abrir()
    expect(await screen.findByText('Solo de B')).toBeInTheDocument()
    expect(mocks.leerPromociones).toHaveBeenCalledWith({}, null)
    expect(screen.getByRole('columnheader', { name: 'Empresa' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nueva promoción' })).toBeDisabled()
    expect(screen.getByText(/Elegí una empresa en la barra superior/)).toBeInTheDocument()
  })

  it('cambio de empresa: recarga, no arrastra filas de la anterior y cierra el diálogo con aviso', async () => {
    const { rerender } = abrir()
    await screen.findByText('Alfa de A')
    fireEvent.click(screen.getByRole('button', { name: 'Nueva promoción' }))
    await screen.findByRole('dialog', { name: 'Nueva promoción' })

    // Cambia la empresa activa de la barra superior; la carga de B queda pendiente.
    let resolverB: (filas: unknown[]) => void = () => undefined
    mocks.leerPromociones.mockImplementationOnce(() => new Promise((resolver) => { resolverB = resolver }))
    mocks.useEmpresasAccesibles.mockReturnValue(accesibles('e2'))
    rerender(<PromocionesList />)

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByText(/Cambiaste de empresa/)).toBeInTheDocument()
    // Mientras carga la nueva, NO se ve ninguna fila de la anterior.
    expect(screen.queryByText('Alfa de A')).toBeNull()
    expect(mocks.leerPromociones).toHaveBeenLastCalledWith({}, 'e2')
    resolverB(DE_B)
    expect(await screen.findByText('Solo de B')).toBeInTheDocument()
    expect(screen.queryByText('Alfa de A')).toBeNull()
    expect(screen.getByText('1 promoción · Tienda B')).toBeInTheDocument()
  })

  it('una respuesta tardía de la empresa anterior no pisa la de la actual', async () => {
    let resolverA: (filas: unknown[]) => void = () => undefined
    mocks.leerPromociones.mockImplementationOnce(() => new Promise((resolver) => { resolverA = resolver }))
    const { rerender } = abrir()
    mocks.useEmpresasAccesibles.mockReturnValue(accesibles('e2'))
    rerender(<PromocionesList />)
    expect(await screen.findByText('Solo de B')).toBeInTheDocument()
    resolverA(DE_A)
    await Promise.resolve()
    expect(screen.queryByText('Alfa de A')).toBeNull()
    expect(screen.getByText('Solo de B')).toBeInTheDocument()
  })

  it('con la bandera apagada (por defecto) lista en modo solo-anular y explica el motivo (MSF-363, decisión 15)', async () => {
    capacidades(false)
    abrir()
    expect(await screen.findByText('Alfa de A')).toBeInTheDocument()
    expect(screen.getByText(/promociones de precio están desactivadas en este entorno/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nueva promoción' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Editar la promoción/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Anular la promoción de Beta de A' })).toBeEnabled()
  })

  it('con la bandera apagada, anular sigue funcionando donde el permiso por tienda lo permite', async () => {
    capacidades(false, { e1: 'lectura', e2: 'edicion' })
    mocks.useEmpresasAccesibles.mockReturnValue(accesibles(null))
    abrir()
    await screen.findByText('Solo de B')
    expect(screen.getByRole('button', { name: 'Anular la promoción de Solo de B' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Anular la promoción de Beta de A' })).toBeNull()
  })

  it('si no se pueden leer las banderas muestra la lista sin acciones de alta ni edición (falla cerrado)', async () => {
    capacidades(false, {}, true)
    abrir()
    expect(await screen.findByText('Alfa de A')).toBeInTheDocument()
    expect(screen.getByText(/No pudimos verificar si las promociones están activas/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nueva promoción' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^(Editar|Anular) la promoción/ })).toBeNull()
  })

  it('con edición en A y solo lectura en B: en B ve la lista sin acciones y «Nueva promoción» deshabilitada con motivo (decisión 14)', async () => {
    capacidades(true, { e1: 'edicion', e2: 'lectura' })
    mocks.useEmpresasAccesibles.mockReturnValue(accesibles('e2'))
    abrir()
    await screen.findByText('Solo de B')
    expect(screen.getByRole('button', { name: 'Nueva promoción' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /^Anular la promoción/ })).toBeNull()
    expect(screen.getByText(/no tenés permiso de edición de productos en ella/)).toBeInTheDocument()
  })

  it('en «Todas mis empresas» las acciones salen solo en las promociones de las tiendas donde edita', async () => {
    capacidades(true, { e1: 'edicion', e2: 'lectura' })
    mocks.useEmpresasAccesibles.mockReturnValue(accesibles(null))
    abrir()
    await screen.findByText('Solo de B')
    expect(screen.getByRole('button', { name: 'Anular la promoción de Beta de A' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Anular la promoción de Solo de B' })).toBeNull()
  })

  it('con lectura se ve la lista sin altas ni acciones', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    abrir()
    await screen.findByText('Alfa de A')
    expect(screen.queryByRole('button', { name: 'Nueva promoción' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Editar la promoción/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Anular la promoción/ })).toBeNull()
  })

  it('estados de vacío y de error con reintento', async () => {
    mocks.leerPromociones.mockResolvedValueOnce([])
    const { unmount } = abrir()
    expect(await screen.findByText('Todavía no hay promociones.')).toBeInTheDocument()
    expect(screen.getByText(/Programá la primera con «Nueva promoción»/)).toBeInTheDocument()
    unmount()

    mocks.leerPromociones.mockRejectedValueOnce(new Error('falla'))
    abrir()
    expect(await screen.findByText('No pudimos cargar las promociones.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Alfa de A')).toBeInTheDocument()
  })
})
