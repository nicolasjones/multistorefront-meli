import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// El detalle de la reparación carga en dos rondas: primero la reparación y después el comprobante asociado.
// «Generar comprobante» solo se ofrece cuando esa segunda consulta terminó, así que con el timeout por
// defecto de Testing Library (1 s) el runner self-hosted (CI + agentes comparten CPU) daba rojo
// intermitente en este archivo. Se sube el default del archivo y el margen de las esperas de la pantalla;
// los asserts siguen siendo estrictos.
vi.setConfig({ testTimeout: 30000 })

// Margen de espera para lo que aparece después de la consulta del comprobante.
const ESPERA = { timeout: 5000 }

const mocks = vi.hoisted(() => ({
  useNivelSeccion: vi.fn(),
  usePuedeAccion: vi.fn(),
  useEmpresasAccesibles: vi.fn(),
  listarModelos: vi.fn(),
  listarEstados: vi.fn(),
  listarHistorial: vi.fn(),
  listarTecnicos: vi.fn(),
  obtenerReparacion: vi.fn(),
  cambiarEstadoReparacion: vi.fn(),
  registrarEntregaReparacion: vi.fn(),
  anularReparacion: vi.fn(),
  obtenerComprobanteDeReparacion: vi.fn(),
  generarComprobanteDeReparacion: vi.fn(),
}))

vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/usePuedeAccion', () => ({ usePuedeAccion: mocks.usePuedeAccion }))
vi.mock('../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: mocks.useEmpresasAccesibles }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: {} }))
// Avisos al cliente (F-SVC-14): fuera del alcance de este archivo; su historial llega vacío y el cliente con correo.
vi.mock('../../lib/reparacionAvisos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/reparacionAvisos')>()),
  listarAvisosDeReparacion: vi.fn().mockResolvedValue([]),
  clienteTieneCorreo: vi.fn().mockResolvedValue(true),
}))
vi.mock('../../lib/serviceTecnico', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/serviceTecnico')>()),
  listarModelos: mocks.listarModelos,
  listarEstados: mocks.listarEstados,
}))
vi.mock('../../lib/reparaciones', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/reparaciones')>()),
  listarTecnicos: mocks.listarTecnicos,
  listarHistorial: mocks.listarHistorial,
  obtenerReparacion: mocks.obtenerReparacion,
  cambiarEstadoReparacion: mocks.cambiarEstadoReparacion,
  registrarEntregaReparacion: mocks.registrarEntregaReparacion,
  anularReparacion: mocks.anularReparacion,
}))
vi.mock('../../lib/reparacionComprobante', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/reparacionComprobante')>()),
  obtenerComprobanteDeReparacion: mocks.obtenerComprobanteDeReparacion,
  generarComprobanteDeReparacion: mocks.generarComprobanteDeReparacion,
}))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../components/service/ClienteSelector', () => ({ ClienteSelector: () => <div /> }))
vi.mock('../../components/service/AltaRapidaClienteDialog', () => ({ AltaRapidaClienteDialog: () => null }))

import type { ItemReparacion, Reparacion } from '../../lib/reparaciones'
import { ServicioReparacion } from './reparacion'

const ESTADO = (id: string, nombre: string, orden: number, extra: object = {}) => ({
  id, nombre, descripcion: `Significado de ${nombre}`, orden, avisa_cliente: false, cierra: false,
  tono: 'neutral', activo: true, updated_at: 't', ...extra,
})

const ITEM: ItemReparacion = {
  id: 'i-1', tipo: 'mano_obra', descripcion: 'Cambio de módulo', producto_id: null, sku: null,
  cantidad: 1, precio_unitario: 45000, subtotal: 45000, deposito_id: null, deposito_nombre: null, stock_estado: 'sin_movimiento',
}

const REPARACION: Reparacion = {
  id: 'r-1', numero: 1, codigo: 'R-0001', empresa_id: 'e-1', empresa: 'San Javucho', cliente_id: 'c-1',
  cliente: 'Ana Pérez', contacto: '', modelo_id: 'm-1', equipo: 'Nintendo Switch', modelo: 'Lite',
  estado_id: 's-1', estado: 'Recibido', estado_cierra: false, estado_tono: 'neutral', numero_serie: null,
  accesorios: '', falla: '', puede_ver_costos: false, costo_mano_obra: null, costo_repuestos: null,
  tecnico_id: null, ingreso_en: '2026-10-01', entrega_prevista: null, entrega_real: null, entregado_por: null,
  anulada_en: null, anulada_motivo: null, updated_at: '2026-10-20T10:00:00Z',
  items: [ITEM], total_mano_obra: 45000, total_repuestos: 0, total_cliente: 45000, ganancia_estimada: null,
}

const COMPROBANTE = {
  id: 'k-1', numero: '00000007', tipo: 'factura', estado: 'borrador', total: 54450,
  empresa_id: 'e-1', empresa: 'San Javucho',
}

const abrirDetalle = () =>
  render(
    <MemoryRouter initialEntries={['/service-tecnico/reparaciones/r-1']}>
      <Routes>
        <Route path="/service-tecnico/reparaciones/:id" element={<ServicioReparacion />} />
        <Route path="/ventas/comprobantes/:id" element={<div>Comprobante de Ventas</div>} />
      </Routes>
    </MemoryRouter>,
  )

const niveles = (service: string, ventas: string) =>
  mocks.useNivelSeccion.mockImplementation((seccion: string) => ({
    nivel: seccion === 'ventas' ? ventas : seccion === 'service_tecnico' ? service : 'ninguno',
    isLoading: false,
  }))

describe('Service técnico · Cobro con comprobante de Ventas (F-SVC-13)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    niveles('edicion', 'edicion')
    mocks.usePuedeAccion.mockReturnValue({ puede: false, isLoading: false })
    mocks.useEmpresasAccesibles.mockReturnValue({
      empresas: [{ id: 'e-1', nombre: 'San Javucho', activa: true }], empresaActivaId: 'e-1', isLoading: false, isError: false,
    })
    mocks.listarModelos.mockResolvedValue([])
    mocks.listarTecnicos.mockResolvedValue([])
    mocks.listarEstados.mockResolvedValue([ESTADO('s-1', 'Recibido', 1)])
    mocks.listarHistorial.mockResolvedValue([])
    mocks.obtenerReparacion.mockResolvedValue(REPARACION)
    mocks.obtenerComprobanteDeReparacion.mockResolvedValue(null)
  })

  it('ofrece «Generar comprobante» junto al total con Service y Ventas en edición, ítems y sin comprobante', async () => {
    abrirDetalle()
    await screen.findByText('Total al cliente', undefined, ESPERA)
    const boton = await screen.findByRole('button', { name: 'Generar comprobante' }, ESPERA)
    expect(boton).toBeEnabled()
    // Vive en la sección «Mano de obra y repuestos», junto al «Total al cliente» (FR-009).
    expect(screen.getByText('Total al cliente')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Comprobante asociado' })).not.toBeInTheDocument()
  })

  it('genera el comprobante por la RPC, lo muestra en la tarjeta y avisa el éxito', async () => {
    mocks.generarComprobanteDeReparacion.mockResolvedValue({ comprobante_id: 'k-1', creado: true })
    mocks.obtenerComprobanteDeReparacion.mockResolvedValueOnce(null).mockResolvedValue(COMPROBANTE)
    abrirDetalle()
    fireEvent.click(await screen.findByRole('button', { name: 'Generar comprobante' }, ESPERA))

    await waitFor(() => expect(mocks.generarComprobanteDeReparacion).toHaveBeenCalledWith('r-1'), ESPERA)
    const tarjeta = await screen.findByRole('region', { name: 'Comprobante asociado' }, ESPERA)
    expect(within(tarjeta).getByText('00000007')).toBeInTheDocument()
    expect(within(tarjeta).getByText('Factura')).toBeInTheDocument()
    expect(within(tarjeta).getByText('Borrador')).toBeInTheDocument()
    expect(within(tarjeta).getByText('San Javucho')).toBeInTheDocument()
    expect(within(tarjeta).getByText(/54\.450/)).toBeInTheDocument()
    expect(within(tarjeta).getByRole('link', { name: 'Abrir en Ventas' })).toHaveAttribute('href', '/ventas/comprobantes/k-1')
    expect(await screen.findByText('Comprobante generado', undefined, ESPERA)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Generar comprobante' })).not.toBeInTheDocument(), ESPERA)
  })

  it('no ofrece «Generar comprobante» sin permiso de Ventas, sin ítems, con la reparación anulada o con comprobante vigente', async () => {
    niveles('edicion', 'lectura')
    const { unmount } = abrirDetalle()
    await screen.findByText('Total al cliente', undefined, ESPERA)
    expect(screen.queryByRole('button', { name: 'Generar comprobante' })).not.toBeInTheDocument()
    unmount()

    niveles('edicion', 'edicion')
    mocks.obtenerReparacion.mockResolvedValue({ ...REPARACION, items: [] })
    const sinItems = abrirDetalle()
    await screen.findByText('Total al cliente', undefined, ESPERA)
    expect(screen.queryByRole('button', { name: 'Generar comprobante' })).not.toBeInTheDocument()
    sinItems.unmount()

    mocks.obtenerReparacion.mockResolvedValue({ ...REPARACION, anulada_en: '2026-10-21T10:00:00Z' })
    const anulada = abrirDetalle()
    await screen.findByText('Total al cliente', undefined, ESPERA)
    expect(screen.queryByRole('button', { name: 'Generar comprobante' })).not.toBeInTheDocument()
    anulada.unmount()

    mocks.obtenerReparacion.mockResolvedValue(REPARACION)
    mocks.obtenerComprobanteDeReparacion.mockResolvedValue(COMPROBANTE)
    abrirDetalle()
    expect(await screen.findByRole('region', { name: 'Comprobante asociado' }, ESPERA)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generar comprobante' })).not.toBeInTheDocument()
  })

  it('muestra el comprobante asociado sin enlace a Ventas cuando no hay acceso a esa sección', async () => {
    niveles('edicion', 'ninguno')
    mocks.obtenerComprobanteDeReparacion.mockResolvedValue(COMPROBANTE)
    abrirDetalle()
    const tarjeta = await screen.findByRole('region', { name: 'Comprobante asociado' }, ESPERA)
    expect(within(tarjeta).getByText('00000007')).toBeInTheDocument()
    expect(within(tarjeta).queryByRole('link', { name: 'Abrir en Ventas' })).not.toBeInTheDocument()
    expect(within(tarjeta).queryByRole('button', { name: 'Generar comprobante' })).not.toBeInTheDocument()
  })

  it('un error al generar se muestra, no se traga y el botón queda disponible para reintentar', async () => {
    mocks.generarComprobanteDeReparacion.mockRejectedValue({ code: '22023', message: 'La reparación no tiene ítems: cargá mano de obra o repuestos para generar el comprobante' })
    abrirDetalle()
    fireEvent.click(await screen.findByRole('button', { name: 'Generar comprobante' }, ESPERA))
    expect(await screen.findByText('La reparación no tiene ítems: cargá mano de obra o repuestos para generar el comprobante', undefined, ESPERA)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generar comprobante' })).toBeEnabled()
  })

  it('si falla la carga del comprobante lo dice y «Reintentar» vuelve a pedirlo', async () => {
    mocks.obtenerComprobanteDeReparacion.mockRejectedValueOnce(new Error('boom'))
    abrirDetalle()
    expect(await screen.findByText('No pudimos cargar el comprobante asociado.', undefined, ESPERA)).toBeInTheDocument()
    mocks.obtenerComprobanteDeReparacion.mockResolvedValue(COMPROBANTE)
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('region', { name: 'Comprobante asociado' }, ESPERA)).toBeInTheDocument()
    expect(mocks.obtenerComprobanteDeReparacion).toHaveBeenCalledTimes(2)
  })

  it('una reparación que la base no encuentra se informa sin mostrar datos de otra', async () => {
    mocks.obtenerComprobanteDeReparacion.mockRejectedValueOnce({ code: 'P0002' })
    abrirDetalle()
    expect(await screen.findByText('Esa reparación no existe o no pertenece a tu organización.', undefined, ESPERA)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Comprobante asociado' })).not.toBeInTheDocument()
  })

  it('al cambiar la empresa activa descarta el comprobante de la anterior y vuelve a pedirlo', async () => {
    mocks.obtenerComprobanteDeReparacion.mockResolvedValue(COMPROBANTE)
    const { rerender } = abrirDetalle()
    await screen.findByRole('region', { name: 'Comprobante asociado' }, ESPERA)

    mocks.obtenerComprobanteDeReparacion.mockResolvedValue(null)
    mocks.useEmpresasAccesibles.mockReturnValue({
      empresas: [{ id: 'e-2', nombre: 'Mundo JC', activa: true }], empresaActivaId: 'e-2', isLoading: false, isError: false,
    })
    rerender(
      <MemoryRouter initialEntries={['/service-tecnico/reparaciones/r-1']}>
        <Routes>
          <Route path="/service-tecnico/reparaciones/:id" element={<ServicioReparacion />} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Comprobante asociado' })).not.toBeInTheDocument(), ESPERA)
    expect(mocks.obtenerComprobanteDeReparacion).toHaveBeenCalledTimes(2)
  })
})
