import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Test de la pantalla «Transportes y contrarreembolso» (F-VTA-14, FR-046 y FR-047) y de los
// envoltorios de sus RPC (FR-045). SC-006 lo cierra la última tarea de la historia.
vi.setConfig({ testTimeout: 20000 })

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  listarTransportes: vi.fn(),
  usePuedeEscribir: vi.fn(),
  useEmpresas: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))
vi.mock('../../../lib/ventas/transportes', async (importar) => ({
  ...(await importar<typeof import('../../../lib/ventas/transportes')>()),
  listarTransportes: mocks.listarTransportes,
}))
vi.mock('../../../hooks/useEmpresas', () => ({ useEmpresas: mocks.useEmpresas }))
vi.mock('../../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: mocks.usePuedeEscribir }))
vi.mock('../../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: null, isLoading: false }) }))
vi.mock('../../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../../components/ventas/TransporteDialog', () => ({ TransporteDialog: () => null }))

import {
  type Contrarreembolso,
  listarContrarreembolsos,
  marcarContrarreembolsoCobrado,
  mensajeDeErrorContrarreembolso,
  resumenContrarreembolsos,
} from '../../../lib/ventas/contrarreembolsos'
import { TransporteList } from './list'

const fila = (extra: Partial<Contrarreembolso> = {}): Contrarreembolso => ({
  id: 'cr-1',
  fecha: '2026-12-01T10:00:00+00:00',
  empresa_id: 'e-1',
  empresa: 'San Javucho',
  comprobante_id: 'f-1',
  numero: '0001-00000001',
  cliente: 'Cliente Uno',
  transporte_id: 't-1',
  transporte: 'Expreso Uno',
  guia: 'G-0001',
  importe: 1000,
  estado: 'pendiente',
  actualizado_en: '2026-12-01T10:00:00+00:00',
  ...extra,
})

describe('envoltorios de los contrarreembolsos (FR-045)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('listar pide la página a la RPC y devuelve las filas con el importe en número', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ ...fila(), importe: '1000.50', filas: 3 }], error: null })
    const resultado = await listarContrarreembolsos({ empresaId: 'e-1', estado: 'pendiente', pagina: 2, tamano: 10 })
    expect(mocks.rpc).toHaveBeenCalledWith('listar_contrarreembolsos', {
      p_empresa_id: 'e-1',
      p_estado: 'pendiente',
      p_pagina: 2,
      p_tamano: 10,
    })
    expect(resultado.contrarreembolsos[0].importe).toBe(1000.5)
    expect(resultado.total).toBe(3)
  })

  it('sin filtro de estado la RPC recibe null (los dos estados)', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    await listarContrarreembolsos({ empresaId: null, estado: null, pagina: 1, tamano: 10 })
    expect(mocks.rpc).toHaveBeenCalledWith('listar_contrarreembolsos', {
      p_empresa_id: null,
      p_estado: null,
      p_pagina: 1,
      p_tamano: 10,
    })
  })

  it('un estado que no existe no viaja a la base', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    await listarContrarreembolsos({
      empresaId: null,
      estado: 'inventado' as never,
      pagina: 1,
      tamano: 10,
    })
    expect(mocks.rpc).toHaveBeenCalledWith('listar_contrarreembolsos', expect.objectContaining({ p_estado: null }))
  })

  it('el resumen trae los tres totales de las tarjetas', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ pendiente_importe: '1000.50', pendiente_cantidad: '2', cobrado_mes_importe: '1500' }],
      error: null,
    })
    const resumen = await resumenContrarreembolsos('e-1')
    expect(mocks.rpc).toHaveBeenCalledWith('resumen_contrarreembolsos', { p_empresa_id: 'e-1' })
    expect(resumen).toEqual({ pendiente_importe: 1000.5, pendiente_cantidad: 2, cobrado_mes_importe: 1500 })
  })

  it('marcar cobrado viaja con el id y la versión leída en pantalla', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...fila({ estado: 'cobrado' }), importe: '1000' }, error: null })
    const resultado = await marcarContrarreembolsoCobrado('cr-1', '2026-12-01T10:00:00+00:00')
    expect(mocks.rpc).toHaveBeenCalledWith('marcar_contrarreembolso_cobrado', {
      p_id: 'cr-1',
      p_actualizado_en: '2026-12-01T10:00:00+00:00',
    })
    expect(resultado.estado).toBe('cobrado')
    expect(resultado.importe).toBe(1000)
  })

  it('sin id o sin versión no se intenta marcar y se avisa con un mensaje claro', async () => {
    await expect(marcarContrarreembolsoCobrado('', '2026-12-01T10:00:00+00:00')).rejects.toThrow(/id/)
    await expect(marcarContrarreembolsoCobrado('cr-1', '  ')).rejects.toThrow(/versión/)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('el error de la base se propaga para que la pantalla lo muestre', async () => {
    const error = { code: '42501', message: 'x' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(marcarContrarreembolsoCobrado('cr-1', '2026-12-01T10:00:00+00:00')).rejects.toBe(error)
  })

  it('los códigos de la base se traducen a castellano sin filtrar el detalle crudo', () => {
    expect(mensajeDeErrorContrarreembolso({ code: '40001' }, 'x')).toContain('Otra persona modificó')
    expect(mensajeDeErrorContrarreembolso({ code: '42501' }, 'x')).toContain('no puede cobrar')
    expect(mensajeDeErrorContrarreembolso({ code: '55000' }, 'x')).toContain('anulada')
    expect(mensajeDeErrorContrarreembolso({ code: 'P0002' }, 'x')).toContain('no pertenece a tu organización')
    expect(mensajeDeErrorContrarreembolso({ code: '22023', message: 'El transporte no cobra' }, 'x')).toBe('El transporte no cobra')
    expect(mensajeDeErrorContrarreembolso({ code: 'XX000' }, 'No pudimos cobrar')).toBe('No pudimos cobrar')
  })
})

describe('Transportes y contrarreembolsos (FR-046)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: true, isLoading: false })
    mocks.useEmpresas.mockReturnValue({
      empresas: [{ id: 'e-1', nombre: 'San Javucho', activa: true }],
      isLoading: false, isError: false,
    })
    mocks.listarTransportes.mockResolvedValue({
      transportes: [{
        id: 't-1', organizacion_id: 'org-1', nombre: 'Expreso Uno', tipo: 'expreso', cuit: null,
        terminal_retiro: 'Terminal Sur', localidad: 'Rosario', telefono: '0341 000-0000', correo: null,
        persona_contacto: null, direccion: null, cobra_contrarreembolso: true, comision_pct: 0,
        plazo_rendicion_dias: 0, orden: 0, activa: true, updated_at: '2026-12-01T10:00:00+00:00', empresas: [],
      }],
      total: 1,
      totalOrganizacion: 30,
    })
  })

  it('muestra el título, el subtítulo y el filtro Tienda del prototipo', () => {
    render(<TransporteList />)
    expect(screen.getByRole('heading', { name: 'Transportes y contrarreembolsos' })).toBeInTheDocument()
    expect(
      screen.getByText('Cobros a la entrega por empresa de transporte, mensajería propia en moto y terminales de retiro.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Todas las tiendas' })).toBeInTheDocument()
    expect(
      screen.getByText('Por defecto se ven todas; si elegís una empresa en la barra superior, se filtra por esa tienda.'),
    ).toBeInTheDocument()
  })

  it('arranca en la sub-pestaña «Contrarreembolsos» con su ayuda', () => {
    render(<TransporteList />)
    const pestanas = screen.getAllByRole('tab')
    expect(pestanas.map((pestana) => pestana.textContent)).toEqual(['Contrarreembolsos', 'Terminales de retiro'])
    expect(pestanas[0]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('El transporte cobra al entregar y rinde después.')).toBeInTheDocument()
  })

  it('la sub-pestaña «Terminales de retiro» conserva la tabla de MSF-139', async () => {
    render(<TransporteList />)
    fireEvent.click(screen.getByRole('tab', { name: 'Terminales de retiro' }))
    expect(await screen.findByText('Expreso Uno')).toBeInTheDocument()
    for (const nombre of ['Empresa de transporte', 'Terminal de retiro', 'Localidad', 'Teléfono', 'Contacto']) {
      expect(screen.getByRole('columnheader', { name: nombre })).toBeInTheDocument()
    }
    // El diálogo y el botón de MSF-139 siguen igual.
    expect(screen.getByRole('button', { name: 'Nueva empresa' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Editar Expreso Uno' })).toBeInTheDocument()
    expect(screen.getByText('1 de 30 empresas de transporte')).toBeInTheDocument()
    // Y la ayuda de la pestaña es la del prototipo.
    expect(screen.getByText('Empresas de transporte y dónde retira cada una.')).toBeInTheDocument()
  })

  it('el filtro Tienda pide esa tienda al servidor', async () => {
    render(<TransporteList />)
    fireEvent.click(screen.getByRole('tab', { name: 'Terminales de retiro' }))
    await screen.findByText('Expreso Uno')
    fireEvent.click(screen.getByRole('button', { name: 'San Javucho' }))
    await waitFor(() =>
      expect(mocks.listarTransportes).toHaveBeenLastCalledWith({ empresaId: 'e-1', pagina: 1, tamano: 25 }),
    )
  })
})
