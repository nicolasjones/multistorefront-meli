import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// F-VTA-18 (MSF-201, FR-047): la integración del diálogo «Registrar faltantes» en el detalle del comprobante.
// Acá se ejercita el cableado real de `comprobante.tsx` (que el diálogo del componente no prueba): elegir
// «Incompleto» abre el diálogo, registrar manda línea y cantidad a `registrar_faltantes_despacho` y la pantalla
// avisa; cambiar de tienda con el diálogo abierto cierra el detalle con aviso y lo desmonta (Principio VIII).

const mocks = vi.hoisted(() => ({
  useNivelSeccion: vi.fn(),
  useEmpresasAccesibles: vi.fn(),
  obtenerComprobante: vi.fn(),
  transicionesPermitidas: vi.fn(),
  historialComprobante: vi.fn(),
  obtenerDespachoComprobante: vi.fn(),
  listarResponsablesDespacho: vi.fn(),
  cambiarEstadoDespacho: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: mocks.useEmpresasAccesibles }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))
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
import type { LineaComprobante } from '../../lib/ventasLineas'
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

const linea = (cambios: Partial<LineaComprobante> = {}): LineaComprobante => ({
  id: 'l-1', orden: 1, producto_id: 'p-1', descripcion: 'Joystick', codigo: 'JOY-1', cantidad: 3, precio_unitario: 800,
  escala: 'x1', precio_manual: false, alicuota_porcentaje: 21, deposito_id: 'd-1', deposito: 'Principal', a_pedido: false,
  stock: 10, reservado: 0, subtotal_sin_iva: 2400, iva: 504, ...cambios,
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
  lineas: [linea(), linea({ id: 'l-2', orden: 2, descripcion: 'Volante', codigo: 'VOL-1', cantidad: 1 })],
  total_sin_iva: 2400,
  iva: 504,
  total_con_iva: 2904,
  editable: false,
  puede_editar: false,
  puede_editar_precio: false,
  updated_at: '2026-10-24T10:00:00Z',
}

// La factura está en Armando: es el estado en el que la base acepta registrar faltantes.
const DESPACHO = {
  estado_despacho: 'armando',
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
  mocks.listarResponsablesDespacho.mockResolvedValue([])
  mocks.rpc.mockResolvedValue({ data: null, error: null })
})

describe('Detalle · «Registrar faltantes» (F-VTA-18, FR-047)', () => {
  it('al elegir «Incompleto» abre el diálogo con las líneas de la factura', async () => {
    render(arbol())
    await screen.findByRole('region', { name: 'Responsables' })

    fireEvent.click(await screen.findByRole('button', { name: 'Elegir el estado Incompleto y registrar los faltantes' }))
    const dialogo = within(await screen.findByRole('dialog', { name: /Registrar faltantes · 00000001/ }))
    expect(dialogo.getByText('Joystick')).toBeInTheDocument()
    expect(dialogo.getByText('Volante')).toBeInTheDocument()
    expect(dialogo.getByRole('textbox', { name: /Cantidad faltante de la línea 1/ })).toBeInTheDocument()
  })

  it('registrar manda la línea y la cantidad a la base, cierra el diálogo y avisa', async () => {
    render(arbol())
    await screen.findByRole('region', { name: 'Responsables' })
    fireEvent.click(await screen.findByRole('button', { name: 'Elegir el estado Incompleto y registrar los faltantes' }))

    const dialogo = within(await screen.findByRole('dialog'))
    fireEvent.change(dialogo.getByRole('textbox', { name: /Cantidad faltante de la línea 1/ }), { target: { value: '2' } })
    fireEvent.click(dialogo.getByRole('button', { name: 'Registrar faltantes' }))

    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('registrar_faltantes_despacho', {
        p_id: 'k-1',
        p_faltantes: [{ linea_orden: 1, cantidad: 2 }],
        p_actualizado_en: '2026-10-24T10:00:00Z',
      }),
    )
    expect(await screen.findByText('Faltantes registrados')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('si la base rechaza el registro el diálogo sigue abierto con el aviso', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } })
    render(arbol())
    await screen.findByRole('region', { name: 'Responsables' })
    fireEvent.click(await screen.findByRole('button', { name: 'Elegir el estado Incompleto y registrar los faltantes' }))

    const dialogo = within(await screen.findByRole('dialog'))
    fireEvent.change(dialogo.getByRole('textbox', { name: /Cantidad faltante de la línea 1/ }), { target: { value: '1' } })
    fireEvent.click(dialogo.getByRole('button', { name: 'Registrar faltantes' }))

    expect(await dialogo.findByText('Tu rol no puede registrar faltantes en esta tienda.')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('al cambiar de tienda con el diálogo abierto cierra el detalle con aviso y desmonta el diálogo', async () => {
    const { rerender } = render(arbol())
    await screen.findByRole('region', { name: 'Responsables' })
    fireEvent.click(await screen.findByRole('button', { name: 'Elegir el estado Incompleto y registrar los faltantes' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()

    mocks.useEmpresasAccesibles.mockReturnValue(accesibles('e-2'))
    rerender(arbol())

    expect(await screen.findByText(/Cambiaste de tienda: cerramos el comprobante/)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // No se registró ningún faltante de la tienda anterior.
    expect(mocks.rpc).not.toHaveBeenCalledWith('registrar_faltantes_despacho', expect.anything())
  })
})
