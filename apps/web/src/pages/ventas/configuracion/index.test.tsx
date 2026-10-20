import { MemoryRouter } from 'react-router'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  returns: vi.fn(),
  useEmpresasAccesibles: vi.fn(),
  useNivelSeccion: vi.fn(),
  usePuedeEscribir: vi.fn(),
  useIsSuperadmin: vi.fn(),
  useOrganizacionDeTrabajo: vi.fn(),
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
}))

vi.mock('../../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: mocks.useEmpresasAccesibles }))
vi.mock('../../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: mocks.usePuedeEscribir }))
vi.mock('../../../hooks/useIsSuperadmin', () => ({ useIsSuperadmin: mocks.useIsSuperadmin }))
vi.mock('../../../hooks/useOrganizacionDeTrabajo', () => ({ useOrganizacionDeTrabajo: mocks.useOrganizacionDeTrabajo }))
vi.mock('../../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

// Cadena fluida de PostgREST: schema().from().select().eq().order().order().returns()
// y from().select().eq().eq().maybeSingle() para el guard. rpc/auth aparte.
vi.mock('../../../lib/supabase', () => {
  const cadena: Record<string, unknown> = {}
  for (const metodo of ['schema', 'from', 'select', 'eq', 'order']) cadena[metodo] = () => cadena
  cadena.returns = mocks.returns
  cadena.maybeSingle = mocks.maybeSingle
  return { supabaseClient: { ...cadena, rpc: mocks.rpc, auth: { getUser: mocks.getUser } } }
})

import { ConfiguracionVentas } from './index'
import { RequiereAccesoSeccion } from '../../../components/RequiereAccesoSeccion'
import type { FormaPago } from '../../../lib/ventas/formasPago'

const SAN_JAVUCHO = { id: 'e-sj', nombre: 'San Javucho', esActiva: true, rolId: 'administrador' }
const MUNDO_JC = { id: 'e-mjc', nombre: 'Mundo JC', esActiva: false, rolId: null }

const forma = (n: number, extra: Partial<FormaPago> = {}): FormaPago => ({
  id: `fp-${n}`, empresa_id: 'e-sj', nombre: `Forma ${n}`, tipo: 'otro', exige_cuenta_cobro: false, genera_deuda: false,
  estado_inicial: 'pendiente', orden: n, activo: true, updated_at: '2026-10-20T10:00:00+00:00', ...extra,
})

const empresas = (lista = [SAN_JAVUCHO, MUNDO_JC], activaId = 'e-sj') => ({
  empresas: lista, empresaActivaId: activaId, isLoading: false, isError: false, refetch: vi.fn(),
})

const renderizarPantalla = () =>
  render(<MemoryRouter><ConfiguracionVentas /></MemoryRouter>)

describe('ConfiguracionVentas (F-VTA-01, FR-003)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: true, isLoading: false })
    mocks.useIsSuperadmin.mockReturnValue({ isSuperadmin: false, isLoading: false })
    mocks.useOrganizacionDeTrabajo.mockReturnValue({ organizacionId: 'org-1', isLoading: false })
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    mocks.maybeSingle.mockResolvedValue({ data: { rol_id: 'operador' }, error: null })
    mocks.useEmpresasAccesibles.mockReturnValue(empresas())
    mocks.returns.mockResolvedValue({ data: [forma(1, { nombre: 'Efectivo' })], error: null })
  })

  it('muestra el título, el subtítulo, el selector de empresa y la pestaña «Formas de pago»', async () => {
    renderizarPantalla()

    expect(await screen.findByRole('heading', { name: 'Configuración de ventas' })).toBeInTheDocument()
    expect(screen.getByText('Catálogos que usa el comprobante. Cada empresa tiene los suyos.')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Formas de pago' })).toBeInTheDocument()
    expect(screen.getByText(/Arranca en la empresa activa de la barra superior/)).toBeInTheDocument()
    // El selector empieza en la empresa activa.
    expect(screen.getByRole('button', { name: 'San Javucho' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Mundo JC' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('lista las formas de la empresa activa y al cambiar de empresa trae las de la otra, sin mezclar', async () => {
    mocks.returns
      .mockResolvedValueOnce({ data: [forma(1, { nombre: 'Efectivo' })], error: null })
      .mockResolvedValueOnce({ data: [forma(2, { nombre: 'Contrarreembolso', empresa_id: 'e-mjc' })], error: null })
    renderizarPantalla()

    expect(await screen.findByText('Efectivo')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Mundo JC' }))

    expect(await screen.findByText('Contrarreembolso')).toBeInTheDocument()
    expect(screen.queryByText('Efectivo')).not.toBeInTheDocument()
    expect(mocks.returns).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['sección en lectura', { nivel: 'lectura' }, { puedeEscribir: true }],
    ['edición pero no Administrador', { nivel: 'edicion' }, { puedeEscribir: false }],
  ])('sin permiso de escritura (%s) no ofrece «Nueva forma de pago»', async (_caso, nivel, escribir) => {
    mocks.useNivelSeccion.mockReturnValue({ ...nivel, isLoading: false })
    mocks.usePuedeEscribir.mockReturnValue({ ...escribir, isLoading: false })
    renderizarPantalla()

    expect(await screen.findByText('Efectivo')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nueva forma de pago' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Editar / })).not.toBeInTheDocument()
  })

  it('con edición y Administrador ofrece «Nueva forma de pago»', async () => {
    renderizarPantalla()

    expect(await screen.findByRole('button', { name: 'Nueva forma de pago' })).toBeInTheDocument()
  })

  it('mientras carga las empresas muestra el estado de carga', () => {
    mocks.useEmpresasAccesibles.mockReturnValue({
      empresas: [], empresaActivaId: null, isLoading: true, isError: false, refetch: vi.fn(),
    })
    renderizarPantalla()

    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
  })

  it('si fallan las empresas muestra el error con «Reintentar»', () => {
    const refetch = vi.fn()
    mocks.useEmpresasAccesibles.mockReturnValue({
      empresas: [], empresaActivaId: null, isLoading: false, isError: true, refetch,
    })
    renderizarPantalla()

    expect(screen.getByText('No pudimos cargar tus empresas.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('sin empresas accesibles muestra el estado vacío y no consulta catálogos', () => {
    mocks.useEmpresasAccesibles.mockReturnValue({
      empresas: [], empresaActivaId: null, isLoading: false, isError: false, refetch: vi.fn(),
    })
    renderizarPantalla()

    expect(screen.getByText('No tenés empresas para configurar.')).toBeInTheDocument()
    expect(mocks.returns).not.toHaveBeenCalled()
  })

  it('sin acceso a la sección muestra «Acceso restringido» y no monta la pantalla de configuración', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'ninguno', isLoading: false })
    render(
      <MemoryRouter>
        <RequiereAccesoSeccion seccion="ventas"><ConfiguracionVentas /></RequiereAccesoSeccion>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Sección no disponible para tu rol')
    expect(screen.queryByRole('heading', { name: 'Configuración de ventas' })).not.toBeInTheDocument()
    expect(mocks.returns).not.toHaveBeenCalled()
  })
})
