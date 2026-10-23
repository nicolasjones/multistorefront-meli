import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Test de INTEGRACIÓN de la pantalla (listado + filtro + diálogo): se sube el timeout del archivo.
vi.setConfig({ testTimeout: 20000 })

const mocks = vi.hoisted(() => ({
  listarTransportes: vi.fn(),
  usePuedeEscribir: vi.fn(),
  useEmpresas: vi.fn(),
}))

vi.mock('../../../lib/ventas/transportes', async (importar) => ({
  ...(await importar<typeof import('../../../lib/ventas/transportes')>()),
  listarTransportes: mocks.listarTransportes,
}))
vi.mock('../../../hooks/useEmpresas', () => ({ useEmpresas: mocks.useEmpresas }))
vi.mock('../../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: mocks.usePuedeEscribir }))
vi.mock('../../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: null, isLoading: false }) }))
vi.mock('../../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../../components/ventas/TransporteDialog', () => ({
  TransporteDialog: ({ open, transporte, onGuardado }: { open: boolean; transporte?: { nombre: string } | null; onGuardado: (t: unknown) => void }) =>
    open ? (
      <div role="dialog" aria-label={transporte ? 'Editar empresa de transporte' : 'Nueva empresa de transporte'}>
        <button type="button" onClick={() => onGuardado({ id: 'nuevo' })}>Guardar empresa</button>
      </div>
    ) : null,
}))

import type { Transporte } from '../../../lib/ventas/transportes'
import { TransporteList } from './list'

const transporte = (n: number, extra: Partial<Transporte> = {}): Transporte => ({
  id: `t-${n}`, organizacion_id: 'org-1', nombre: `Transporte ${n}`, tipo: 'expreso', cuit: null,
  terminal_retiro: null, localidad: null, telefono: null, correo: null, persona_contacto: null, direccion: null,
  cobra_contrarreembolso: false, comision_pct: 0, plazo_rendicion_dias: 0, orden: 0, activa: true,
  updated_at: '2026-01-01T10:00:00+00:00', empresas: [], ...extra,
})

const pagina = (transportes: Transporte[], extra: Partial<{ total: number; totalOrganizacion: number }> = {}) => ({
  transportes, total: transportes.length, totalOrganizacion: transportes.length, ...extra,
})

const ultimoPedido = () => mocks.listarTransportes.mock.calls.at(-1)![0]

describe('TransporteList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: true, isLoading: false })
    mocks.useEmpresas.mockReturnValue({
      empresas: [{ id: 'e-1', nombre: 'San Javucho', activa: true }, { id: 'e-2', nombre: 'Mundo JC', activa: true }],
      isLoading: false, isError: false,
    })
    mocks.listarTransportes.mockResolvedValue(pagina([
      transporte(1, { terminal_retiro: 'Terminal Sur, Av. Ejemplo 500', localidad: 'Rosario', telefono: '0341 000-0000', persona_contacto: 'Atención a clientes' }),
      transporte(2, { tipo: 'moto_propia', activa: false }),
    ], { totalOrganizacion: 30 }))
  })

  it('muestra título, descripción, columnas del prototipo, «—» sin dato y el recuento «N de M empresas de transporte»', async () => {
    render(<TransporteList />)
    expect(await screen.findByText('Transporte 1')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Transportes' })).toBeInTheDocument()
    expect(screen.getByText('Empresas de transporte y dónde retira cada una.')).toBeInTheDocument()
    for (const nombre of ['Empresa de transporte', 'Terminal de retiro', 'Localidad', 'Teléfono', 'Contacto']) {
      expect(screen.getByRole('columnheader', { name: nombre })).toBeInTheDocument()
    }
    expect(screen.queryByRole('columnheader', { name: 'Envíos del mes' })).not.toBeInTheDocument()
    expect(screen.getByText('Terminal Sur, Av. Ejemplo 500')).toBeInTheDocument()
    expect(screen.getByText('Rosario')).toBeInTheDocument()
    expect(screen.getByText('0341 000-0000')).toBeInTheDocument()
    expect(screen.getByText('Atención a clientes')).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.getByText('2 de 30 empresas de transporte')).toBeInTheDocument()
    // Sin identificadores técnicos a la vista.
    expect(screen.queryByText('t-1')).not.toBeInTheDocument()
    expect(ultimoPedido()).toEqual({ empresaId: null, pagina: 1, tamano: 25 })
  })

  it('distingue al transporte inactivo y muestra el tipo', async () => {
    render(<TransporteList />)
    await screen.findByText('Transporte 2')
    expect(screen.getByText('Inactiva')).toBeInTheDocument()
    expect(screen.getByText('Moto propia')).toBeInTheDocument()
    expect(screen.getByText('Expreso')).toBeInTheDocument()
  })

  it('el filtro Tienda pide esa tienda al servidor y vuelve a «Todas las tiendas»', async () => {
    render(<TransporteList />)
    await screen.findByText('Transporte 1')
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Tienda' }))
    expect(screen.getByRole('option', { name: 'Todas las tiendas' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: 'Mundo JC' }))
    await waitFor(() => expect(ultimoPedido()).toEqual({ empresaId: 'e-2', pagina: 1, tamano: 25 }))
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Tienda' }))
    fireEvent.click(screen.getByRole('option', { name: 'Todas las tiendas' }))
    await waitFor(() => expect(ultimoPedido().empresaId).toBeNull())
  })

  it('con el filtro y sin resultados avisa que ninguna empresa se usa en esa tienda', async () => {
    render(<TransporteList />)
    await screen.findByText('Transporte 1')
    mocks.listarTransportes.mockResolvedValue(pagina([], { totalOrganizacion: 30 }))
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Tienda' }))
    fireEvent.click(screen.getByRole('option', { name: 'San Javucho' }))
    expect(await screen.findByText('Sin resultados')).toBeInTheDocument()
    expect(screen.getByText('0 de 30 empresas de transporte')).toBeInTheDocument()
  })

  it('pagina en el servidor: la página 2 se pide con pagina = 2', async () => {
    mocks.listarTransportes.mockResolvedValue(pagina([transporte(1)], { total: 60, totalOrganizacion: 60 }))
    render(<TransporteList />)
    await screen.findByText('Transporte 1')
    expect(screen.getByText('1–25 de 60')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente/i }))
    await waitFor(() => expect(ultimoPedido()).toMatchObject({ pagina: 2 }))
  })

  it('el Administrador ve «Nueva empresa» y «Editar»; al guardar avisa «Empresa de transporte guardada» y recarga', async () => {
    render(<TransporteList />)
    await screen.findByText('Transporte 1')
    expect(screen.getByRole('button', { name: 'Editar Transporte 1' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Nueva empresa' }))
    expect(screen.getByRole('dialog', { name: 'Nueva empresa de transporte' })).toBeInTheDocument()
    const llamadas = mocks.listarTransportes.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Guardar empresa' }))
    expect(await screen.findByText('Empresa de transporte guardada')).toBeInTheDocument()
    await waitFor(() => expect(mocks.listarTransportes.mock.calls.length).toBeGreaterThan(llamadas))
  })

  it('«Editar» abre el diálogo de edición', async () => {
    render(<TransporteList />)
    await screen.findByText('Transporte 1')
    fireEvent.click(screen.getByRole('button', { name: 'Editar Transporte 1' }))
    expect(screen.getByRole('dialog', { name: 'Editar empresa de transporte' })).toBeInTheDocument()
  })

  it('quien no es Administrador ve el listado pero no «Nueva empresa» ni «Editar»', async () => {
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: false, isLoading: false })
    render(<TransporteList />)
    await screen.findByText('Transporte 1')
    expect(screen.queryByRole('button', { name: 'Nueva empresa' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Editar/ })).not.toBeInTheDocument()
  })

  it('sin transportes: estado vacío con la invitación a cargar el primero (solo Administrador)', async () => {
    mocks.listarTransportes.mockResolvedValue(pagina([]))
    render(<TransporteList />)
    expect(await screen.findByText('Todavía no hay empresas de transporte cargadas.')).toBeInTheDocument()
    expect(screen.getByText('Cargá la primera para empezar.')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Nueva empresa' }).length).toBeGreaterThan(0)
  })

  it('si falla la carga muestra el error y «Reintentar» vuelve a pedir', async () => {
    mocks.listarTransportes.mockRejectedValueOnce(new Error('caída'))
    render(<TransporteList />)
    expect(await screen.findByText('No pudimos cargar los transportes.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Transporte 1')).toBeInTheDocument()
  })
})
