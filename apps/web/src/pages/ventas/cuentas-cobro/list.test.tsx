import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Test de INTEGRACIÓN de la pantalla (varios filtros + RPC): con la suite shardeada el default de 5 s
// quedaba justo y daba falsos rojos. Se sube el timeout del archivo.
vi.setConfig({ testTimeout: 20000 })

const mocks = vi.hoisted(() => ({
  useListarCuentasCobro: vi.fn(),
  usePuedeEscribir: vi.fn(),
  useFiltroPorEmpresaActiva: vi.fn(),
  cambiarEstado: vi.fn(),
  refetch: vi.fn(),
  elegirEmpresa: vi.fn(),
}))

vi.mock('../../../hooks/useListarCuentasCobro', () => ({ useListarCuentasCobro: mocks.useListarCuentasCobro }))
vi.mock('../../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: mocks.usePuedeEscribir }))
vi.mock('../../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: mocks.useFiltroPorEmpresaActiva }))
vi.mock('../../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../../lib/ventas/cuentasCobro', async (importarOriginal) => ({
  ...(await importarOriginal<typeof import('../../../lib/ventas/cuentasCobro')>()),
  cambiarEstadoCuentaCobro: mocks.cambiarEstado,
}))
vi.mock('../../../components/ventas/CuentaCobroDialog', () => ({
  CuentaCobroDialog: ({ cuenta, onGuardado, onCerrar }: { cuenta: { nombre: string } | null; onGuardado: (r: { alta: boolean; nombre: string }) => void; onCerrar: () => void }) => (
    <div role="dialog" aria-label={cuenta ? `Editar ${cuenta.nombre}` : 'Nueva cuenta'}>
      <button type="button" onClick={() => onGuardado({ alta: !cuenta, nombre: 'X' })}>Guardar cuenta</button>
      <button type="button" onClick={onCerrar}>Cancelar</button>
    </div>
  ),
}))

import type { CuentaCobro } from '../../../lib/ventas/cuentasCobro'
import { CuentasCobroList } from './list'

const cuenta = (n: number, extra: Partial<CuentaCobro> = {}): CuentaCobro => ({
  id: `c-${n}`, nombre: `Cuenta ${n}`, titular: `Titular ${n}`, banco: `Banco ${n}`, cbu: '0170099220000067797370',
  cuit: '30701234568', alias: null, tipo: 'cuenta_corriente', moneda: 'ARS', orden: n, activa: true, notas: null,
  updated_at: '2026-01-01T10:00:00+00:00', empresas: [], ...extra,
})

const respuesta = (cuentas: CuentaCobro[], extra: Record<string, unknown> = {}) => ({
  cuentas, total: cuentas.length, isLoading: false, isFetching: false, isError: false, refetch: mocks.refetch, ...extra,
})

const ultimosFiltros = () => mocks.useListarCuentasCobro.mock.calls.at(-1)![0]
const abrir = () => render(<CuentasCobroList />)

describe('CuentasCobroList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.refetch.mockResolvedValue(undefined)
    mocks.cambiarEstado.mockResolvedValue(undefined)
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: true, isLoading: false })
    mocks.useFiltroPorEmpresaActiva.mockReturnValue({
      empresas: [{ id: 'e-1', nombre: 'San Javucho' }, { id: 'e-2', nombre: 'Mundo JC' }],
      valor: null, cambiar: mocks.elegirEmpresa, empresaActivaId: null, cargando: false, hayError: false,
    })
    mocks.useListarCuentasCobro.mockReturnValue(respuesta([
      cuenta(1, { empresas: [{ id: 'e-2', nombre: 'Mundo JC' }, { id: 'e-1', nombre: 'San Javucho' }] }),
      cuenta(2, { activa: false, banco: null, cuit: null }),
    ]))
  })

  it('muestra título, descripción, aviso de «No usar» y las columnas del prototipo', () => {
    abrir()
    expect(screen.getByRole('heading', { name: 'Cuentas de cobro' })).toBeInTheDocument()
    expect(screen.getByText(/No son depósitos de mercadería/)).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('conserva su historial de pagos')
    for (const nombre of ['Cuenta', 'Titular', 'Banco', 'CBU', 'CUIT', 'Disponible en', 'Estado']) {
      expect(screen.getByRole('columnheader', { name: nombre })).toBeInTheDocument()
    }
    expect(ultimosFiltros()).toEqual({ empresaId: null, estado: 'todas', pagina: 1, tamano: 10 })
  })

  it('muestra el CUIT con guiones, «Disponible en» como chips, «—» si falta un dato y el estado', () => {
    abrir()
    expect(screen.getByText('30-70123456-8')).toBeInTheDocument()
    expect(screen.getByText('Mundo JC', { selector: '.MuiChip-label' })).toBeInTheDocument()
    expect(screen.getByText('San Javucho', { selector: '.MuiChip-label' })).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Activa')).toBeInTheDocument()
    expect(screen.getByText('No usar', { selector: '.MuiChip-label' })).toBeInTheDocument()
    // Sin identificadores técnicos a la vista.
    expect(screen.queryByText('c-1')).not.toBeInTheDocument()
  })

  it('el recuento y la paginación dicen «1–10 de N» y pasan de página en el servidor', () => {
    mocks.useListarCuentasCobro.mockReturnValue(respuesta([cuenta(1)], { total: 23 }))
    abrir()
    expect(screen.getByText('23 cuentas')).toBeInTheDocument()
    expect(screen.getByText('1–10 de 23')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente/i }))
    expect(ultimosFiltros().pagina).toBe(2)
  })

  it('el filtro Tienda ofrece «Todas las tiendas» y una por empresa, y vuelve a la página 1', () => {
    mocks.useListarCuentasCobro.mockReturnValue(respuesta([cuenta(1)], { total: 23 }))
    abrir()
    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente/i }))
    expect(ultimosFiltros().pagina).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: 'Mundo JC' }))
    expect(mocks.elegirEmpresa).toHaveBeenCalledWith('e-2')
    expect(ultimosFiltros().pagina).toBe(1)
    expect(screen.getByRole('button', { name: 'Todas las tiendas' })).toBeInTheDocument()
  })

  it('la empresa activa de la barra superior filtra la lista', () => {
    mocks.useFiltroPorEmpresaActiva.mockReturnValue({
      empresas: [{ id: 'e-1', nombre: 'San Javucho' }], valor: 'e-1', cambiar: mocks.elegirEmpresa,
      empresaActivaId: 'e-1', cargando: false, hayError: false,
    })
    abrir()
    expect(ultimosFiltros().empresaId).toBe('e-1')
  })

  it('el filtro de estado pide «No usar» al servidor', () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'No usar' }))
    expect(ultimosFiltros().estado).toBe('no_usar')
    fireEvent.click(screen.getByRole('button', { name: 'Activas' }))
    expect(ultimosFiltros().estado).toBe('activas')
  })

  it('el Administrador ve «Nueva cuenta de cobro» y las acciones de editar y No usar', () => {
    abrir()
    expect(screen.getByRole('button', { name: 'Nueva cuenta de cobro' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Editar Cuenta 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Marcar No usar Cuenta 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reactivar Cuenta 2' })).toBeInTheDocument()
  })

  it('quien no es Administrador ve la lista pero no «Nueva cuenta de cobro» ni acciones', () => {
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: false, isLoading: false })
    abrir()
    expect(screen.getByText('Cuenta 1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nueva cuenta de cobro' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Editar|Marcar No usar|Reactivar/ })).not.toBeInTheDocument()
  })

  it('mientras se resuelven los permisos tampoco muestra acciones (falla cerrada)', () => {
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: null, isLoading: true })
    abrir()
    expect(screen.queryByRole('button', { name: 'Nueva cuenta de cobro' })).not.toBeInTheDocument()
  })

  it('«Marcar No usar» cambia el estado, avisa y recarga la lista', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Marcar No usar Cuenta 1' }))
    await waitFor(() => expect(mocks.cambiarEstado).toHaveBeenCalledWith('c-1', false))
    expect(await screen.findByText('Cuenta marcada como No usar')).toBeInTheDocument()
    expect(mocks.refetch).toHaveBeenCalled()
  })

  it('«Reactivar» vuelve a ofrecer la cuenta', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Reactivar Cuenta 2' }))
    await waitFor(() => expect(mocks.cambiarEstado).toHaveBeenCalledWith('c-2', true))
    expect(await screen.findByText('Cuenta reactivada')).toBeInTheDocument()
  })

  it('si el cambio de estado falla muestra el error en castellano y no recarga', async () => {
    mocks.cambiarEstado.mockRejectedValue({ code: '42501', message: 'permission denied' })
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Marcar No usar Cuenta 1' }))
    expect(await screen.findByText(/Solo un Administrador puede hacer esta acción/)).toBeInTheDocument()
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument()
    expect(mocks.refetch).not.toHaveBeenCalled()
  })

  it('al crear una cuenta avisa «Cuenta de cobro creada» y recarga', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Nueva cuenta de cobro' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Guardar cuenta' }))
    expect(await screen.findByText('Cuenta de cobro creada')).toBeInTheDocument()
    expect(mocks.refetch).toHaveBeenCalled()
  })

  it('editar abre el diálogo con la cuenta elegida', () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Editar Cuenta 1' }))
    expect(screen.getByRole('dialog', { name: 'Editar Cuenta 1' })).toBeInTheDocument()
  })

  it('muestra carga, error con «Reintentar» y vacío', () => {
    mocks.useListarCuentasCobro.mockReturnValue(respuesta([], { isLoading: true }))
    const { unmount } = abrir()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    unmount()

    mocks.useListarCuentasCobro.mockReturnValue(respuesta([], { isError: true }))
    const segundo = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(mocks.refetch).toHaveBeenCalled()
    segundo.unmount()

    mocks.useListarCuentasCobro.mockReturnValue(respuesta([]))
    abrir()
    expect(screen.getByText('Todavía no hay cuentas de cobro cargadas.')).toBeInTheDocument()
  })

  it('con un filtro activo y sin resultados lo dice distinto a «no hay cuentas»', () => {
    mocks.useListarCuentasCobro.mockReturnValue(respuesta([]))
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'No usar' }))
    expect(screen.getByText('Sin resultados')).toBeInTheDocument()
  })
})
