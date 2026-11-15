import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useNivelSeccion: vi.fn(),
  useEmpresasAccesibles: vi.fn(),
  obtenerComprobante: vi.fn(),
  guardarComprobante: vi.fn(),
  transicionesPermitidas: vi.fn(),
  historialComprobante: vi.fn(),
}))

vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: mocks.useEmpresasAccesibles }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: {} }))
vi.mock('../../lib/depositos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/depositos')>()),
  listarDepositos: vi.fn(async () => []),
}))
vi.mock('../../lib/ventas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/ventas')>()),
  obtenerComprobante: mocks.obtenerComprobante,
  guardarComprobante: mocks.guardarComprobante,
}))
vi.mock('../../lib/ventasConfirmacion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/ventasConfirmacion')>()),
  confirmarComprobante: vi.fn(),
}))
vi.mock('../../lib/estadosComprobante', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/estadosComprobante')>()),
  transicionesPermitidas: mocks.transicionesPermitidas,
  historialComprobante: mocks.historialComprobante,
}))
vi.mock('../../lib/ventasDespacho', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/ventasDespacho')>()),
  obtenerDespachoComprobante: vi.fn(async () => ({
    estado_despacho: 'sin_armar',
    armo_id: null,
    armo: null,
    controlo_id: null,
    controlo: null,
    entrego_id: null,
    entrego: null,
    entregado_en: null,
    updated_at: '2026-10-24T10:00:00Z',
    puede_despachar: false,
  })),
  listarResponsablesDespacho: vi.fn(async () => []),
  cambiarEstadoDespacho: vi.fn(async () => undefined),
}))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../components/service/ClienteSelector', () => ({ ClienteSelector: () => <div /> }))

import type { Comprobante } from '../../lib/ventas'
import { ComprobanteVenta } from './comprobante'

const EMPRESAS = [{ id: 'e-1', nombre: 'San Javucho', esActiva: true }]

const COMPROBANTE: Comprobante = {
  id: 'k-1',
  tipo: 'factura',
  numero: '00000007',
  estado: 'borrador',
  empresa_id: 'e-1',
  empresa: 'San Javucho',
  cliente: { id: 'c-1', nombre: 'Ana Pérez', documento: '20-12345678-3', direccion: null, tipo: 'minorista', es_consumidor_final: false },
  canal: 'mostrador',
  fecha: '2026-10-24',
  valido_hasta: null,
  operador_id: 'u-1',
  operador: 'Lucía Gómez',
  forma_pago_id: null,
  envio_id: null,
  origen_tipo: 'reparacion',
  origen_id: 'r-1',
  origen_numero: 'R-0001',
  lineas: [],
  total_sin_iva: 45000,
  iva: 9450,
  total_con_iva: 54450,
  editable: true,
  puede_editar: true,
  puede_editar_precio: true,
  updated_at: '2026-10-24T10:00:00Z',
}

const arbol = () =>
  render(
    <MemoryRouter initialEntries={['/ventas/comprobantes/k-1']}>
      <Routes>
        <Route path="/ventas/comprobantes/:id" element={<ComprobanteVenta />} />
      </Routes>
    </MemoryRouter>,
  )

const niveles = (service: string) =>
  mocks.useNivelSeccion.mockImplementation((seccion: string) => ({
    nivel: seccion === 'service_tecnico' ? service : 'edicion',
    isLoading: false,
  }))

describe('Ventas · Origen del comprobante de una reparación (F-SVC-13, FR-007)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    niveles('lectura')
    mocks.useEmpresasAccesibles.mockReturnValue({
      empresas: EMPRESAS, empresaActivaId: 'e-1', isLoading: false, isError: false,
    })
    mocks.obtenerComprobante.mockResolvedValue(COMPROBANTE)
    mocks.transicionesPermitidas.mockResolvedValue([])
    mocks.historialComprobante.mockResolvedValue([])
  })

  it('muestra «Reparación R-0001» con enlace al detalle de Service cuando hay acceso a Service', async () => {
    arbol()
    expect(await screen.findByRole('heading', { name: 'Factura 00000007' })).toBeInTheDocument()
    const enlace = screen.getByRole('link', { name: 'Reparación R-0001' })
    expect(enlace).toHaveAttribute('href', '/service-tecnico/reparaciones/r-1')
  })

  it('muestra el origen como texto sin enlace cuando no hay acceso a Service', async () => {
    niveles('ninguno')
    arbol()
    expect(await screen.findByRole('heading', { name: 'Factura 00000007' })).toBeInTheDocument()
    expect(screen.getByText(/Reparación R-0001/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Reparación R-0001' })).not.toBeInTheDocument()
  })

  it('un comprobante sin origen no muestra la línea de origen', async () => {
    mocks.obtenerComprobante.mockResolvedValue({ ...COMPROBANTE, origen_tipo: null, origen_id: null, origen_numero: null })
    arbol()
    expect(await screen.findByRole('heading', { name: 'Factura 00000007' })).toBeInTheDocument()
    expect(screen.queryByText(/Reparación R-/)).not.toBeInTheDocument()
  })
})
