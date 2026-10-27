import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// F-VTA-16 (MSF-166, FR-023): el bloque «Envío y transporte» del comprobante solo existe en una factura
// confirmada (el envío se registra sobre la factura confirmada). Al cambiar la empresa activa la pantalla se
// cierra con aviso y el bloque no queda con datos de la tienda anterior (Principio VIII).

const mocks = vi.hoisted(() => ({
  useNivelSeccion: vi.fn(),
  useEmpresasAccesibles: vi.fn(),
  obtenerComprobante: vi.fn(),
  transicionesPermitidas: vi.fn(),
  historialComprobante: vi.fn(),
  obtenerDespachoComprobante: vi.fn(),
  listarResponsablesDespacho: vi.fn(),
  cambiarEstadoDespacho: vi.fn(),
  obtenerFormaEnvioDeComprobante: vi.fn(),
  obtenerEnvioComprobante: vi.fn(),
  obtenerTransportePorId: vi.fn(),
  listarTransportesDeEmpresa: vi.fn(),
  guardarEnvioComprobante: vi.fn(),
}))

vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: mocks.useEmpresasAccesibles }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: vi.fn() } }))
vi.mock('../../lib/depositos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/depositos')>()),
  listarDepositos: vi.fn(async () => []),
}))
vi.mock('../../lib/ventas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/ventas')>()),
  obtenerComprobante: mocks.obtenerComprobante,
  obtenerClienteParaComprobante: vi.fn(async () => null),
}))
vi.mock('../../lib/estadosComprobante', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/estadosComprobante')>()),
  transicionesPermitidas: mocks.transicionesPermitidas,
  historialComprobante: mocks.historialComprobante,
}))
vi.mock('../../lib/ventasDespacho', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/ventasDespacho')>()),
  obtenerDespachoComprobante: mocks.obtenerDespachoComprobante,
  listarResponsablesDespacho: mocks.listarResponsablesDespacho,
  cambiarEstadoDespacho: mocks.cambiarEstadoDespacho,
}))
// Solo se reemplazan las lecturas y el guardado: los rótulos, la elegibilidad y los mensajes son los de la
// biblioteca (los verifica `ventasEnvio.test.ts`).
vi.mock('../../lib/ventasEnvio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/ventasEnvio')>()),
  obtenerFormaEnvioDeComprobante: mocks.obtenerFormaEnvioDeComprobante,
  obtenerEnvioComprobante: mocks.obtenerEnvioComprobante,
  obtenerTransportePorId: mocks.obtenerTransportePorId,
  listarTransportesDeEmpresa: mocks.listarTransportesDeEmpresa,
  guardarEnvioComprobante: mocks.guardarEnvioComprobante,
}))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../components/service/ClienteSelector', () => ({ ClienteSelector: () => <div /> }))

import type { Comprobante } from '../../lib/ventas'
import { ComprobanteVenta } from './comprobante'

const EMPRESAS = [
  { id: 'e-1', nombre: 'San Javucho', esActiva: true },
  { id: 'e-2', nombre: 'Mundo JC', esActiva: false },
]

const accesibles = (activa: string | null) => ({
  empresas: EMPRESAS.map((empresa) => ({ ...empresa, esActiva: empresa.id === activa })),
  empresaActivaId: activa,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
})

const FACTURA: Comprobante = {
  id: 'k-1',
  tipo: 'factura',
  numero: '00000001',
  estado: 'confirmada',
  empresa_id: 'e-1',
  empresa: 'San Javucho',
  cliente: { id: 'c-1', nombre: 'Ana Pérez', documento: '20-12345678-3', direccion: 'Av. Ejemplo 1234', tipo: 'mayorista', es_consumidor_final: false },
  canal: 'mostrador',
  fecha: '2026-10-24',
  valido_hasta: null,
  operador_id: 'u-1',
  operador: 'Lucía Gómez',
  forma_pago_id: null,
  envio_id: 'f-1',
  lineas: [],
  total_sin_iva: 0,
  iva: 0,
  total_con_iva: 0,
  editable: false,
  puede_editar: false,
  puede_editar_precio: false,
  updated_at: '2026-10-24T10:00:00Z',
}

const DESPACHO = {
  estado_despacho: 'sin_armar',
  armo_id: null,
  armo: null,
  controlo_id: null,
  controlo: null,
  entrego_id: null,
  entrego: null,
  entregado_en: null,
  updated_at: '2026-10-24T10:00:00Z',
  puede_despachar: true,
}

const FORMA_ENVIO = {
  id: 'f-1',
  nombre: 'Expreso',
  tipo: 'expreso',
  exige_transporte_guia: true,
}

const ENVIO = {
  transporte_id: null,
  guia: null,
  fecha_envio: null,
  updated_at: '2026-10-24T10:00:00Z',
}

function UbicacionActual() {
  const ubicacion = useLocation()
  return <div>{`En ${ubicacion.pathname}: ${(ubicacion.state as { mensaje?: string } | null)?.mensaje ?? ''}`}</div>
}

const arbol = () => (
  <MemoryRouter initialEntries={['/ventas/comprobantes/k-1']}>
    <Routes>
      <Route path="/ventas/comprobantes/:id" element={<ComprobanteVenta />} />
      <Route path="/ventas/comprobantes" element={<UbicacionActual />} />
    </Routes>
  </MemoryRouter>
)

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
  mocks.useEmpresasAccesibles.mockReturnValue(accesibles('e-1'))
  mocks.obtenerComprobante.mockResolvedValue(FACTURA)
  mocks.transicionesPermitidas.mockResolvedValue(['aceptado', 'en_proceso'])
  mocks.historialComprobante.mockResolvedValue([])
  mocks.obtenerDespachoComprobante.mockResolvedValue(DESPACHO)
  mocks.listarResponsablesDespacho.mockResolvedValue([{ user_id: 'u-2', nombre: 'Emilse Sosa', rol_id: 'deposito' }])
  mocks.obtenerFormaEnvioDeComprobante.mockResolvedValue(FORMA_ENVIO)
  mocks.obtenerEnvioComprobante.mockResolvedValue(ENVIO)
  mocks.obtenerTransportePorId.mockResolvedValue(null)
  mocks.listarTransportesDeEmpresa.mockResolvedValue([])
})

describe('Detalle · bloque «Envío y transporte» (F-VTA-16)', () => {
  it('en una factura confirmada muestra el bloque con la forma de envío de la tienda', async () => {
    render(arbol())
    const bloque = await screen.findByRole('region', { name: 'Envío y transporte' })
    expect(bloque).toBeInTheDocument()
    // El selector de transporte se lee con la forma de envío de la empresa del comprobante.
    expect(mocks.obtenerFormaEnvioDeComprobante).toHaveBeenCalledWith('e-1', 'f-1')
    expect(await screen.findByRole('combobox', { name: /Transporte \/ expreso/ })).toBeInTheDocument()
  })

  it('en una factura sin confirmar no muestra el bloque: el envío se registra sobre la factura confirmada', async () => {
    mocks.obtenerComprobante.mockResolvedValue({ ...FACTURA, estado: 'borrador', editable: true })
    render(arbol())
    await screen.findByRole('heading', { name: /Factura 00000001/ })
    expect(screen.queryByRole('region', { name: 'Envío y transporte' })).not.toBeInTheDocument()
    expect(mocks.obtenerFormaEnvioDeComprobante).not.toHaveBeenCalled()
  })

  it('en un presupuesto no muestra el bloque', async () => {
    mocks.obtenerComprobante.mockResolvedValue({ ...FACTURA, tipo: 'presupuesto' })
    render(arbol())
    await screen.findByRole('heading', { name: /Presupuesto 00000001/ })
    expect(screen.queryByRole('region', { name: 'Envío y transporte' })).not.toBeInTheDocument()
    expect(mocks.obtenerFormaEnvioDeComprobante).not.toHaveBeenCalled()
  })
})

describe('Detalle · empresa activa del envío (FR-023, Principio VIII)', () => {
  it('al cambiar a otra tienda cierra el comprobante con aviso y no deja el bloque de la anterior', async () => {
    const { rerender } = render(arbol())
    await screen.findByRole('region', { name: 'Envío y transporte' })
    mocks.useEmpresasAccesibles.mockReturnValue(accesibles('e-2'))
    rerender(arbol())
    expect(await screen.findByText(/Cambiaste de tienda: cerramos el comprobante/)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Envío y transporte' })).not.toBeInTheDocument())
    expect(mocks.guardarEnvioComprobante).not.toHaveBeenCalled()
  })
})
