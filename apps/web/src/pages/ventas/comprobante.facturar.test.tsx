import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useNivelSeccion: vi.fn(),
  useEmpresasAccesibles: vi.fn(),
  obtenerComprobante: vi.fn(),
  guardarComprobante: vi.fn(),
  transicionesPermitidas: vi.fn(),
  historialComprobante: vi.fn(),
  facturarPresupuesto: vi.fn(),
  obtenerVinculoPresupuesto: vi.fn(),
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
vi.mock('../../lib/ventasPresupuestos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/ventasPresupuestos')>()),
  facturarPresupuesto: mocks.facturarPresupuesto,
  obtenerVinculoPresupuesto: mocks.obtenerVinculoPresupuesto,
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

const PRESUPUESTO: Comprobante = {
  id: 'k-1',
  tipo: 'presupuesto',
  numero: '00000012',
  estado: 'aceptado',
  empresa_id: 'e-1',
  empresa: 'San Javucho',
  cliente: { id: 'c-1', nombre: 'Ana Pérez', documento: '20-12345678-3', direccion: null, tipo: 'minorista', es_consumidor_final: false },
  canal: 'mostrador',
  fecha: '2026-10-24',
  valido_hasta: '2099-12-31',
  operador_id: 'u-1',
  operador: 'Lucía Gómez',
  forma_pago_id: null,
  envio_id: null,
  origen_tipo: null,
  origen_id: null,
  origen_numero: null,
  lineas: [],
  total_sin_iva: 45000,
  iva: 9450,
  total_con_iva: 54450,
  editable: false,
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

describe('Ventas · Facturar un presupuesto aceptado', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.useEmpresasAccesibles.mockReturnValue({ empresas: EMPRESAS, empresaActivaId: 'e-1', isLoading: false, isError: false })
    mocks.obtenerComprobante.mockResolvedValue(PRESUPUESTO)
    mocks.transicionesPermitidas.mockResolvedValue([])
    mocks.historialComprobante.mockResolvedValue([])
    mocks.obtenerVinculoPresupuesto.mockResolvedValue(null)
    mocks.facturarPresupuesto.mockResolvedValue({ id: 'f-1', numero: '00000031', estado: 'borrador' })
  })

  it('un presupuesto aceptado y vigente ofrece «Facturar» y abre la factura creada', async () => {
    arbol()
    fireEvent.click(await screen.findByRole('button', { name: 'Facturar' }))
    // La ruta es la misma (`:id`): la pantalla pasa a leer la factura creada.
    await waitFor(() => expect(mocks.obtenerComprobante).toHaveBeenCalledWith('f-1'))
    expect(mocks.facturarPresupuesto).toHaveBeenCalledWith('k-1')
  })

  it('un doble clic factura una sola vez', async () => {
    mocks.facturarPresupuesto.mockReturnValue(new Promise(() => undefined))
    arbol()
    const boton = await screen.findByRole('button', { name: 'Facturar' })
    fireEvent.click(boton)
    fireEvent.click(boton)
    expect(mocks.facturarPresupuesto).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: 'Facturando…' })).toBeDisabled()
  })

  it('no ofrece «Facturar» si está pendiente, vencido, convertido, con lectura o es una factura', async () => {
    for (const cambio of [
      { estado: 'pendiente' },
      { valido_hasta: '2020-01-01' },
      { estado: 'convertido' },
      { tipo: 'factura', estado: 'borrador', valido_hasta: null },
    ]) {
      mocks.obtenerComprobante.mockResolvedValue({ ...PRESUPUESTO, ...cambio })
      const { unmount } = arbol()
      await screen.findByRole('heading', { level: 1 })
      expect(screen.queryByRole('button', { name: 'Facturar' })).not.toBeInTheDocument()
      unmount()
    }
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    mocks.obtenerComprobante.mockResolvedValue(PRESUPUESTO)
    arbol()
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('button', { name: 'Facturar' })).not.toBeInTheDocument()
  })

  it('si la base rechaza muestra el mensaje de negocio, no el genérico, y relee el presupuesto', async () => {
    mocks.facturarPresupuesto.mockRejectedValue({ code: '55000', message: 'El presupuesto está vencido y no se puede facturar' })
    arbol()
    fireEvent.click(await screen.findByRole('button', { name: 'Facturar' }))
    expect(await screen.findByText('El presupuesto está vencido y no se puede facturar')).toBeInTheDocument()
    await waitFor(() => expect(mocks.obtenerComprobante.mock.calls.length).toBeGreaterThan(1))
  })

  it('un presupuesto convertido enlaza a su factura', async () => {
    mocks.obtenerComprobante.mockResolvedValue({ ...PRESUPUESTO, estado: 'convertido' })
    mocks.obtenerVinculoPresupuesto.mockResolvedValue({ presupuesto_id: 'k-1', presupuesto_numero: '00000012', factura_id: 'f-1', factura_numero: '00000031', factura_estado: 'borrador' })
    arbol()
    const enlace = await screen.findByRole('link', { name: '00000031' })
    expect(enlace).toHaveAttribute('href', '/ventas/comprobantes/f-1')
    expect(screen.getByText(/se convirtió en la factura/)).toBeInTheDocument()
    expect(screen.getByText('Convertido en factura')).toBeInTheDocument()
  })

  it('una factura nacida de un presupuesto enlaza al presupuesto de origen', async () => {
    mocks.obtenerComprobante.mockResolvedValue({ ...PRESUPUESTO, tipo: 'factura', numero: '00000031', estado: 'borrador', valido_hasta: null, editable: true })
    mocks.obtenerVinculoPresupuesto.mockResolvedValue({ presupuesto_id: 'k-9', presupuesto_numero: '00000012', factura_id: 'k-1', factura_numero: '00000031', factura_estado: 'borrador' })
    arbol()
    const enlace = await screen.findByRole('link', { name: '00000012' })
    expect(enlace).toHaveAttribute('href', '/ventas/comprobantes/k-9')
    expect(screen.getByText(/nació del presupuesto/)).toBeInTheDocument()
  })

  it('un comprobante sin vínculo no muestra ningún enlace de origen', async () => {
    mocks.obtenerComprobante.mockResolvedValue({ ...PRESUPUESTO, tipo: 'factura', estado: 'borrador', valido_hasta: null, editable: true })
    arbol()
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByText(/nació del presupuesto|se convirtió en la factura/)).not.toBeInTheDocument()
  })
})
