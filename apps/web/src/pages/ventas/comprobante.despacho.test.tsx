import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// F-VTA-15 (MSF-152, FR-010/FR-012): la tarjeta «Responsables» del despacho vive en el detalle del comprobante
// y solo aparece en una factura confirmada (el despacho arranca al confirmar). Al cambiar la empresa activa la
// pantalla se cierra con aviso y la tarjeta no queda con datos de la tienda anterior (Principio VIII).

const mocks = vi.hoisted(() => ({
  useNivelSeccion: vi.fn(),
  useEmpresasAccesibles: vi.fn(),
  obtenerComprobante: vi.fn(),
  transicionesPermitidas: vi.fn(),
  historialComprobante: vi.fn(),
  obtenerDespachoComprobante: vi.fn(),
  listarResponsablesDespacho: vi.fn(),
  cambiarEstadoDespacho: vi.fn(),
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
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../components/service/ClienteSelector', () => ({ ClienteSelector: () => <div /> }))

import type { Comprobante } from '../../lib/ventas'
import { MENSAJE_DESPACHO_SOLO_LECTURA } from '../../lib/ventasDespacho'
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
  envio_id: null,
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
})

describe('Detalle · tarjeta «Responsables» (F-VTA-15)', () => {
  it('en una factura confirmada muestra la tarjeta con el estado de despacho', async () => {
    render(arbol())
    const tarjeta = await screen.findByRole('region', { name: 'Responsables' })
    expect(await screen.findByText('Sin armar')).toBeInTheDocument()
    expect(tarjeta).toContainElement(screen.getByText('Sin armar'))
    expect(mocks.obtenerDespachoComprobante).toHaveBeenCalledWith('k-1')
  })

  it('en una factura sin confirmar no muestra la tarjeta: el despacho arranca al confirmar', async () => {
    mocks.obtenerComprobante.mockResolvedValue({ ...FACTURA, estado: 'borrador', editable: true })
    render(arbol())
    await screen.findByRole('heading', { name: /Factura 00000001/ })
    expect(screen.queryByRole('region', { name: 'Responsables' })).not.toBeInTheDocument()
    expect(mocks.obtenerDespachoComprobante).not.toHaveBeenCalled()
  })

  it('en un presupuesto no muestra la tarjeta', async () => {
    mocks.obtenerComprobante.mockResolvedValue({ ...FACTURA, tipo: 'presupuesto' })
    render(arbol())
    await screen.findByRole('heading', { name: /Presupuesto 00000001/ })
    expect(screen.queryByRole('region', { name: 'Responsables' })).not.toBeInTheDocument()
  })

  // MSF-715: tras el cobro la factura pasa a «cobrado»/«deuda». Los responsables ya registrados se
  // siguen leyendo (no desaparecen del detalle) pero la base ya no admite avanzar el despacho.
  it('con la factura cobrada la tarjeta sigue visible, en solo lectura', async () => {
    mocks.obtenerComprobante.mockResolvedValue({
      ...FACTURA,
      estado: 'cobrado',
      updated_at: '2026-10-25T10:00:00Z',
    })
    render(arbol())

    expect(await screen.findByRole('region', { name: 'Responsables' })).toBeInTheDocument()
    expect(await screen.findByText('Sin armar')).toBeInTheDocument()
    // No se ofrece avanzar el despacho: la base solo despacha una factura confirmada.
    expect(screen.queryByRole('button', { name: 'Empezar a armar' })).not.toBeInTheDocument()
    expect(await screen.findByText(MENSAJE_DESPACHO_SOLO_LECTURA)).toBeInTheDocument()
  })
})

describe('Detalle · empresa activa (FR-012, Principio VIII)', () => {
  it('al cambiar a otra tienda cierra el comprobante con aviso y no deja la tarjeta de la anterior', async () => {
    const { rerender } = render(arbol())
    await screen.findByRole('region', { name: 'Responsables' })
    mocks.useEmpresasAccesibles.mockReturnValue(accesibles('e-2'))
    rerender(arbol())
    expect(await screen.findByText(/Cambiaste de tienda: cerramos el comprobante/)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Responsables' })).not.toBeInTheDocument())
    expect(mocks.cambiarEstadoDespacho).not.toHaveBeenCalled()
  })
})
