import { MemoryRouter } from 'react-router'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Test de INTEGRACIÓN de la pantalla (tarjetas + filtros + paginación): con la suite shardeada el
// default de 5 s quedaba justo y daba falsos rojos. Se sube el timeout del archivo.
vi.setConfig({ testTimeout: 20000 })

const mocks = vi.hoisted(() => ({
  useFiltroPorEmpresaActiva: vi.fn(),
  listarPagos: vi.fn(),
  resumenPagos: vi.fn(),
  cuentasCobroMasUsadas: vi.fn(),
  elegirEmpresa: vi.fn(),
  useNivelSeccion: vi.fn(),
  useIsSuperadmin: vi.fn(),
  useOrganizacionDeTrabajo: vi.fn(),
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
}))

vi.mock('../../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: mocks.useFiltroPorEmpresaActiva }))
vi.mock('../../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../../lib/ventas/pagos', () => ({
  listarPagos: mocks.listarPagos,
  resumenPagos: mocks.resumenPagos,
  cuentasCobroMasUsadas: mocks.cuentasCobroMasUsadas,
  mensajeDeErrorPagos: (_error: unknown, porDefecto: string) => porDefecto,
}))
vi.mock('../../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../../hooks/useIsSuperadmin', () => ({ useIsSuperadmin: mocks.useIsSuperadmin }))
vi.mock('../../../hooks/useOrganizacionDeTrabajo', () => ({ useOrganizacionDeTrabajo: mocks.useOrganizacionDeTrabajo }))
// El guard de sección pide el rol del usuario cuando no hay acceso.
vi.mock('../../../lib/supabase', () => {
  const cadena: Record<string, unknown> = {}
  for (const metodo of ['from', 'select', 'eq']) cadena[metodo] = () => cadena
  cadena.maybeSingle = mocks.maybeSingle
  return { supabaseClient: { ...cadena, auth: { getUser: mocks.getUser } } }
})

import { PagosList } from './list'
import { RequiereAccesoSeccion } from '../../../components/RequiereAccesoSeccion'
import { DESTINOS_PANEL } from '../../../components/navegacion/destinosPanel'

const RESUMEN = {
  por_conciliar_importe: 2100,
  por_conciliar_cantidad: 6,
  conciliado_importe: 400,
  conciliado_cantidad: 1,
  saldo_pendiente: 2500,
}

const CUENTAS = [
  { id: 'c-1', nombre: 'Banco Uno', banco: 'Galicia', activa: true, usos: 4, total_cuentas: 3 },
  { id: 'c-2', nombre: 'Banco No usar', banco: 'Santander', activa: false, usos: 1, total_cuentas: 3 },
]

const FILTROS = {
  empresas: [{ id: 'e-1', nombre: 'San Javucho' }, { id: 'e-2', nombre: 'Mundo JC' }],
  valor: null as string | null,
  cambiar: mocks.elegirEmpresa,
  empresaActivaId: null as string | null,
  cargando: false,
  hayError: false,
}

const abrir = () => render(<MemoryRouter><PagosList /></MemoryRouter>)

const ultimoListado = () => mocks.listarPagos.mock.calls.at(-1)![0]

describe('PagosList (F-VTA-13, FR-025)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.useFiltroPorEmpresaActiva.mockReturnValue(FILTROS)
    mocks.listarPagos.mockResolvedValue({ pagos: [], total: 20 })
    mocks.resumenPagos.mockResolvedValue(RESUMEN)
    mocks.cuentasCobroMasUsadas.mockResolvedValue(CUENTAS)
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.useIsSuperadmin.mockReturnValue({ isSuperadmin: false, isLoading: false })
    mocks.useOrganizacionDeTrabajo.mockReturnValue({ organizacionId: 'org-1', isLoading: false })
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'u-1' } } })
    mocks.maybeSingle.mockResolvedValue({ data: { rol_id: 'mostrador' }, error: null })
  })

  it('muestra el título, el subtítulo y el texto del filtro Tienda', async () => {
    abrir()

    expect(screen.getByRole('heading', { name: 'Pagos' })).toBeInTheDocument()
    expect(screen.getByText('Conciliación de cobros: cada pago por transferencia o depósito se aprueba contra la cuenta bancaria.')).toBeInTheDocument()
    expect(screen.getByText(/Por defecto se ven todas; si elegís una empresa en la barra superior/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Todas las tiendas' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'San Javucho' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mundo JC' })).toBeInTheDocument()
    await waitFor(() => expect(mocks.listarPagos).toHaveBeenCalled())
  })

  it('muestra las tres tarjetas con el importe y la bajada', async () => {
    abrir()

    expect(await screen.findByText('$ 2.100')).toBeInTheDocument()
    expect(screen.getByText('Por conciliar')).toBeInTheDocument()
    expect(screen.getByText('6 pagos sin aprobar')).toBeInTheDocument()
    expect(screen.getByText('Conciliado')).toBeInTheDocument()
    expect(screen.getByText('$ 400')).toBeInTheDocument()
    expect(screen.getByText('1 pago aprobado')).toBeInTheDocument()
    expect(screen.getByText('Saldo pendiente de clientes')).toBeInTheDocument()
    expect(screen.getByText('$ 2.500')).toBeInTheDocument()
    expect(screen.getByText('Comprobantes con pago parcial')).toBeInTheDocument()
  })

  it('el filtro de cuentas ofrece «Todas» y una por cuenta, y filtra por la elegida', async () => {
    abrir()
    await screen.findByRole('button', { name: 'Banco Uno' })

    expect(screen.getByRole('button', { name: 'Todas' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Banco Uno' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Banco No usar' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Banco Uno' }))

    await waitFor(() => expect(ultimoListado().cuentaCobroId).toBe('c-1'))
    expect(ultimoListado().empresaId).toBeNull()
    expect(ultimoListado().soloConSaldo).toBe(false)
  })

  it('«Solo con saldo» filtra los pagos que todavía deben', async () => {
    abrir()
    await screen.findByText('$ 2.100')

    fireEvent.click(screen.getByRole('checkbox', { name: 'Solo con saldo' }))

    await waitFor(() => expect(ultimoListado().soloConSaldo).toBe(true))
  })

  it('la paginación dice «1–9 de N» y pasa de página en el servidor', async () => {
    abrir()
    expect(await screen.findByText('1–9 de 20')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente/i }))

    await waitFor(() => expect(ultimoListado().pagina).toBe(2))
  })

  it('la empresa activa de la barra superior filtra y vuelve a la primera página', async () => {
    mocks.useFiltroPorEmpresaActiva.mockReturnValue({ ...FILTROS, valor: 'e-1', empresaActivaId: 'e-1' })
    abrir()
    await screen.findByText('$ 2.100')

    expect(ultimoListado().empresaId).toBe('e-1')

    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente/i }))
    await waitFor(() => expect(ultimoListado().pagina).toBe(2))

    fireEvent.click(screen.getByRole('button', { name: 'Mundo JC' }))
    expect(mocks.elegirEmpresa).toHaveBeenCalledWith('e-2')
    await waitFor(() => expect(ultimoListado().pagina).toBe(1))
  })

  it('si la base falla muestra el error y ofrece «Reintentar»', async () => {
    mocks.listarPagos.mockRejectedValue({ code: '42501', message: 'denegado' })
    abrir()

    expect(await screen.findByText('No pudimos cargar los pagos. Intentá de nuevo.')).toBeInTheDocument()
    mocks.listarPagos.mockResolvedValue({ pagos: [], total: 20 })
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(mocks.listarPagos).toHaveBeenCalledTimes(2))
  })

  it('el menú ofrece la entrada «Pagos» con su ruta', () => {
    const destino = DESTINOS_PANEL.find((item) => item.id === 'ventas-pagos')
    expect(destino).toMatchObject({ etiqueta: 'Pagos', ruta: '/ventas/pagos', seccionPermiso: 'ventas' })
    expect(destino?.icono).toBeDefined()
  })

  it('sin acceso a la sección muestra «Acceso restringido» y no monta la pantalla', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'ninguno', isLoading: false })
    render(
      <MemoryRouter>
        <RequiereAccesoSeccion seccion="ventas"><PagosList /></RequiereAccesoSeccion>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Sección no disponible para tu rol')
    expect(screen.queryByRole('heading', { name: 'Pagos' })).not.toBeInTheDocument()
    expect(mocks.listarPagos).not.toHaveBeenCalled()
  })
})
