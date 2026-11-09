import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useOrdenesCompra: vi.fn(),
  useDetalleOrdenCompra: vi.fn(),
  useCrearOrdenCompra: vi.fn(),
  useCambiarEstadoOrdenCompra: vi.fn(),
  useProductosEnReposicion: vi.fn(),
  empresaActiva: vi.fn(),
  nivelSeccion: vi.fn(),
  useEmpresasAccesibles: vi.fn(),
  useProveedoresBasico: vi.fn(),
}))

vi.mock('../../hooks/useOrdenesCompra', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/useOrdenesCompra')>()),
  useOrdenesCompra: mocks.useOrdenesCompra,
  useDetalleOrdenCompra: mocks.useDetalleOrdenCompra,
  useCrearOrdenCompra: mocks.useCrearOrdenCompra,
  useCambiarEstadoOrdenCompra: mocks.useCambiarEstadoOrdenCompra,
  useProductosEnReposicion: mocks.useProductosEnReposicion,
}))
vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: mocks.empresaActiva }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.nivelSeccion }))
vi.mock('../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: mocks.useEmpresasAccesibles }))
vi.mock('../../hooks/useProveedoresBasico', () => ({ useProveedoresBasico: mocks.useProveedoresBasico }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { OrdenesCompra } from './ordenes-compra'

const EMPRESA = '11111111-1111-1111-1111-111111111111'
const PROVEEDOR = '22222222-2222-2222-2222-222222222222'
const PRODUCTO = '33333333-3333-3333-3333-333333333333'

const ORDENES = [
  {
    orden_id: 'orden-1',
    fecha: '2026-11-05',
    estado: 'emitida' as const,
    proveedor: 'Proveedor Uno',
    empresa: 'Tienda Uno',
    unidades: 12,
    fecha_recepcion: null,
    motivo_anulacion: null,
    total: 1,
  },
]

const EMPRESAS = [{ id: EMPRESA, nombre: 'Tienda Uno', esActiva: true }]
const PROVEEDORES = [
  { id: PROVEEDOR, razon_social: 'Proveedor Uno', activo: true },
  { id: '55555555-5555-5555-5555-555555555555', razon_social: 'Proveedor Inactivo', activo: false },
]

const abrir = () => render(<MemoryRouter><OrdenesCompra /></MemoryRouter>)

// ContenidoAdaptable cambia de tabla a tarjetas en xs: se emula el ancho con matchMedia.
function mockAnchoPantalla(angosta: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: angosta, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

describe('Órdenes de compra (F-PRV-09)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAnchoPantalla(false)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.empresaActiva.mockReturnValue({
      empresas: EMPRESAS,
      valor: EMPRESA,
      cambiar: vi.fn(),
      cargando: false,
      hayError: false,
    })
    mocks.nivelSeccion.mockReturnValue({ nivel: 'edicion' })
    mocks.useEmpresasAccesibles.mockReturnValue({
      empresas: EMPRESAS,
      empresaActivaId: EMPRESA,
      isLoading: false,
      isError: false,
    })
    mocks.useProveedoresBasico.mockReturnValue({ proveedores: PROVEEDORES, cargando: false, hayError: false })
    mocks.useOrdenesCompra.mockReturnValue({
      filas: ORDENES,
      total: 1,
      hayError: false,
      cargando: false,
      recargar: vi.fn(),
    })
    mocks.useDetalleOrdenCompra.mockReturnValue({
      detalle: {
        id: 'orden-1',
        fecha: '2026-11-05',
        estado: 'emitida',
        observaciones: null,
        fecha_recepcion: null,
        motivo_anulacion: null,
        empresa: 'Tienda Uno',
        proveedor: 'Proveedor Uno',
        lineas: [{ producto_id: PRODUCTO, producto_nombre: 'Producto Uno', producto_sku: 'P-1', cantidad: 12 }],
      },
      hayError: false,
      cargando: false,
      recargar: vi.fn(),
    })
    mocks.useProductosEnReposicion.mockReturnValue({
      productos: [{ producto_id: PRODUCTO, nombre: 'Producto Uno', sku: 'P-1', disponible: 0, minimo: 10, estado: 'sin_stock', cantidad_sugerida: 10 }],
      cargando: false,
      hayError: false,
      recargar: vi.fn(),
    })
    mocks.useCrearOrdenCompra.mockReturnValue({ crear: vi.fn().mockResolvedValue({ ok: true, id: 'orden-2' }), enviando: false })
    mocks.useCambiarEstadoOrdenCompra.mockReturnValue({ cambiar: vi.fn().mockResolvedValue({ ok: true }), enviando: false })
  })

  it('lista las órdenes con fecha, proveedor, tienda, estado y unidades', async () => {
    abrir()
    const tabla = await screen.findByRole('table', { name: 'Órdenes de compra a proveedores' })
    const encabezados = within(tabla).getAllByRole('columnheader').map((celda) => celda.textContent)
    expect(encabezados).toEqual(['Fecha', 'Proveedor', 'Tienda', 'Estado', 'Unidades', 'Acciones'])
    expect(within(tabla).getByText('Proveedor Uno')).toBeInTheDocument()
    expect(within(tabla).getByText('Tienda Uno')).toBeInTheDocument()
    expect(within(tabla).getByText('Emitida')).toBeInTheDocument()
  })

  it('filtra por la empresa activa de la barra superior', async () => {
    abrir()
    await screen.findByRole('table', { name: 'Órdenes de compra a proveedores' })
    expect(mocks.useOrdenesCompra).toHaveBeenCalledWith(expect.objectContaining({ empresaId: EMPRESA }))
  })

  it('con solo lectura no ofrece crear ni cambiar el estado', async () => {
    mocks.nivelSeccion.mockReturnValue({ nivel: 'lectura' })
    abrir()
    await screen.findByRole('table', { name: 'Órdenes de compra a proveedores' })
    expect(screen.queryByRole('button', { name: 'Nueva orden de compra' })).not.toBeInTheDocument()
    expect(screen.getByText(/no crear ni cambiar su estado/)).toBeInTheDocument()
  })

  it('muestra el estado vacío cuando no hay órdenes', async () => {
    mocks.useOrdenesCompra.mockReturnValue({ filas: [], total: 0, hayError: false, cargando: false, recargar: vi.fn() })
    abrir()
    expect(await screen.findByText('Todavía no hay órdenes de compra.')).toBeInTheDocument()
  })

  it('muestra el error con reintento cuando el listado falla', async () => {
    const recargar = vi.fn()
    mocks.useOrdenesCompra.mockReturnValue({ filas: null, total: 0, hayError: true, cargando: false, recargar })
    abrir()
    expect(await screen.findByText('No pudimos cargar las órdenes de compra.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(recargar).toHaveBeenCalled()
  })

  it('el alta exige elegir un producto en alerta antes de enviar', async () => {
    const crear = vi.fn()
    mocks.useCrearOrdenCompra.mockReturnValue({ crear, enviando: false })
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva orden de compra' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Crear orden de compra' }))
    expect(await within(dialogo).findByText('Elegí al menos un producto en alerta de reposición.')).toBeInTheDocument()
    expect(crear).not.toHaveBeenCalled()
  })

  it('crea la orden con el proveedor y los productos en alerta', async () => {
    const crear = vi.fn().mockResolvedValue({ ok: true, id: 'orden-2' })
    mocks.useCrearOrdenCompra.mockReturnValue({ crear, enviando: false })
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva orden de compra' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.mouseDown(within(dialogo).getByRole('combobox', { name: 'Proveedor' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Proveedor Uno' }))
    fireEvent.click(await within(dialogo).findByRole('checkbox'))
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Crear orden de compra' }))
    await waitFor(() => expect(crear).toHaveBeenCalled())
    expect(crear.mock.calls[0][0]).toMatchObject({
      empresa_id: EMPRESA,
      proveedor_id: PROVEEDOR,
      items: [{ producto_id: PRODUCTO, cantidad: 10 }],
    })
  })

  it('el detalle ofrece recibir y anular solo con edición en Stock', async () => {
    const cambiar = vi.fn().mockResolvedValue({ ok: true })
    mocks.useCambiarEstadoOrdenCompra.mockReturnValue({ cambiar, enviando: false })
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Ver' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Marcar como recibida' }))
    await waitFor(() => expect(cambiar).toHaveBeenCalledWith('orden-1', 'recibida'))
  })

  it('sin edición el detalle no ofrece cambiar el estado', async () => {
    mocks.nivelSeccion.mockReturnValue({ nivel: 'lectura' })
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Ver' }))
    const dialogo = await screen.findByRole('dialog')
    expect(within(dialogo).queryByRole('button', { name: 'Marcar como recibida' })).not.toBeInTheDocument()
    expect(within(dialogo).queryByRole('button', { name: 'Anular' })).not.toBeInTheDocument()
  })
})
