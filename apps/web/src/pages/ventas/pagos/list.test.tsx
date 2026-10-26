import { MemoryRouter } from 'react-router'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Test de INTEGRACIÓN de la pantalla (tarjetas + filtros + paginación): con la suite shardeada el
// default de 5 s quedaba justo y daba falsos rojos. Se sube el timeout del archivo.
vi.setConfig({ testTimeout: 20000 })

const mocks = vi.hoisted(() => ({
  useFiltroPorEmpresaActiva: vi.fn(),
  listarPagos: vi.fn(),
  resumenPagos: vi.fn(),
  cuentasCobroMasUsadas: vi.fn(),
  conciliarPago: vi.fn(),
  revertirConciliacionPago: vi.fn(),
  puedeConciliarPago: vi.fn(),
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
  conciliarPago: mocks.conciliarPago,
  revertirConciliacionPago: mocks.revertirConciliacionPago,
  puedeConciliarPago: mocks.puedeConciliarPago,
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

// Las cuentas de la otra tienda: el filtro de cuenta de la tienda anterior no existe en esta.
const CUENTAS_OTRA_TIENDA = [
  { id: 'c-9', nombre: 'Banco Otro', banco: 'HSBC', activa: true, usos: 1, total_cuentas: 1 },
]

const PAGO = {
  id: 'p-1',
  fecha: '2026-12-01T10:00:00+00:00',
  empresa_id: 'e-1',
  empresa: 'San Javucho',
  comprobante_id: 'f-1',
  numero: '0001-00000001',
  cliente: 'Distribuidora Norte SRL',
  cuenta_cobro_id: 'c-1',
  cuenta_cobro: 'Banco Uno',
  importe: 400,
  aprobado_por: null,
  conciliado: false,
  saldo: 600,
  actualizado_en: '2026-12-01T10:00:00+00:00',
}

const PAGO_APROBADO = {
  ...PAGO,
  id: 'p-2',
  numero: '0001-00000002',
  conciliado: true,
  aprobado_por: 'Rita Ramírez',
  saldo: 0,
  actualizado_en: '2026-12-02T10:00:00+00:00',
}

const APROBADO = {
  id: 'p-1',
  importe: 400,
  cuenta_cobro_id: 'c-1',
  aprobado_por: 'u-1',
  aprobado_por_nombre: 'Rita Ramírez',
  aprobado_en: '2026-12-02T10:00:00+00:00',
  actualizado_en: '2026-12-02T10:00:00+00:00',
}

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

// La tabla del prototipo es una tabla en ancho completo: en jsdom el ancho no se emula, así que
// se fuerza el ancho para que `ContenidoAdaptable` no la cambie por tarjetas.
function mockAnchoPantalla(angosta: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: angosta, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

describe('PagosList (F-VTA-13, FR-025)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockAnchoPantalla(false)
    mocks.useFiltroPorEmpresaActiva.mockReturnValue(FILTROS)
    mocks.listarPagos.mockResolvedValue({ pagos: [], total: 20 })
    mocks.resumenPagos.mockResolvedValue(RESUMEN)
    mocks.cuentasCobroMasUsadas.mockResolvedValue(CUENTAS)
    mocks.puedeConciliarPago.mockResolvedValue(true)
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

describe('PagosList · la tabla de pagos (FR-026)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockAnchoPantalla(false)
    mocks.useFiltroPorEmpresaActiva.mockReturnValue(FILTROS)
    mocks.resumenPagos.mockResolvedValue(RESUMEN)
    mocks.cuentasCobroMasUsadas.mockResolvedValue(CUENTAS)
    mocks.puedeConciliarPago.mockResolvedValue(true)
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.useIsSuperadmin.mockReturnValue({ isSuperadmin: false, isLoading: false })
    mocks.useOrganizacionDeTrabajo.mockReturnValue({ organizacionId: 'org-1', isLoading: false })
  })

  it('muestra las columnas del prototipo', async () => {
    mocks.listarPagos.mockResolvedValue({ pagos: [PAGO], total: 1 })
    abrir()

    const tabla = await screen.findByRole('table', { name: 'Pagos' })
    const encabezados = within(tabla).getAllByRole('columnheader').map((celda) => celda.textContent)
    expect(encabezados).toEqual([
      'Fecha', 'Tienda', 'Comprobante', 'Cliente', 'Cuenta de cobro', 'Importe', 'Aprobado por', 'Cobrado', 'Saldo',
    ])
  })

  it('muestra la fila con la fecha, la tienda, el comprobante enlazado, el cliente, la cuenta y el saldo', async () => {
    mocks.listarPagos.mockResolvedValue({ pagos: [PAGO], total: 1 })
    abrir()

    const tabla = await screen.findByRole('table', { name: 'Pagos' })
    expect(within(tabla).getByText('01/12/2026')).toBeInTheDocument()
    expect(within(tabla).getByText('San Javucho')).toBeInTheDocument()
    expect(within(tabla).getByRole('link', { name: '0001-00000001' })).toHaveAttribute('href', '/ventas/comprobantes/f-1')
    expect(within(tabla).getByText('Distribuidora Norte SRL')).toBeInTheDocument()
    expect(within(tabla).getByText('Banco Uno')).toBeInTheDocument()
    expect(within(tabla).getByText('Cuenta de San Javucho')).toBeInTheDocument()
    expect(within(tabla).getByText('$ 400')).toBeInTheDocument()
    // Sin aprobación no hay «Aprobado por»: va «—».
    expect(within(tabla).getByText('—')).toBeInTheDocument()
    // El saldo del comprobante: lo que le queda al cliente.
    expect(within(tabla).getByText('$ 600')).toBeInTheDocument()
  })

  it('un pago conciliado muestra quién lo aprobó y el saldo en «—»', async () => {
    mocks.listarPagos.mockResolvedValue({ pagos: [PAGO_APROBADO], total: 1 })
    abrir()

    const tabla = await screen.findByRole('table', { name: 'Pagos' })
    expect(within(tabla).getByText('Rita Ramírez')).toBeInTheDocument()
    expect(within(tabla).getByText('—')).toBeInTheDocument()
    expect(within(tabla).queryByText('$ 600')).not.toBeInTheDocument()
  })

  it('el interruptor «Cobrado» concilia el pago y avisa «Pago conciliado · N»', async () => {
    mocks.listarPagos.mockResolvedValue({ pagos: [PAGO], total: 1 })
    mocks.conciliarPago.mockResolvedValue(APROBADO)
    abrir()

    const interruptor = await screen.findByRole('switch', { name: 'Cobrado 0001-00000001' })
    await waitFor(() => expect(interruptor).toBeEnabled())
    fireEvent.click(interruptor)

    await waitFor(() => expect(mocks.conciliarPago).toHaveBeenCalledWith('p-1', '2026-12-01T10:00:00+00:00'))
    expect(await screen.findByText('Pago conciliado · 0001-00000001')).toBeInTheDocument()
    // La pantalla vuelve a leer los pagos: la fila y las tarjetas salen de la base.
    await waitFor(() => expect(mocks.listarPagos.mock.calls.length).toBeGreaterThan(1))
  })

  it('el interruptor de un pago conciliado revierte la conciliación y avisa «Conciliación revertida · N»', async () => {
    mocks.listarPagos.mockResolvedValue({ pagos: [PAGO_APROBADO], total: 1 })
    mocks.revertirConciliacionPago.mockResolvedValue({ ...APROBADO, id: 'p-2', aprobado_por: null, aprobado_por_nombre: null })
    abrir()

    const interruptor = await screen.findByRole('switch', { name: 'Cobrado 0001-00000002' })
    await waitFor(() => expect(interruptor).toBeEnabled())
    expect(interruptor).toBeChecked()
    fireEvent.click(interruptor)

    await waitFor(() => expect(mocks.revertirConciliacionPago).toHaveBeenCalledWith('p-2', '2026-12-02T10:00:00+00:00'))
    expect(await screen.findByText('Conciliación revertida · 0001-00000002')).toBeInTheDocument()
  })

  it('sin la acción `conciliar_pago` el interruptor va deshabilitado', async () => {
    mocks.listarPagos.mockResolvedValue({ pagos: [PAGO], total: 1 })
    mocks.puedeConciliarPago.mockResolvedValue(false)
    abrir()

    const interruptor = await screen.findByRole('switch', { name: 'Cobrado 0001-00000001' })
    await waitFor(() => expect(mocks.puedeConciliarPago).toHaveBeenCalledWith('e-1'))
    await waitFor(() => expect(interruptor).toBeDisabled())

    fireEvent.click(interruptor)
    expect(mocks.conciliarPago).not.toHaveBeenCalled()
  })

  it('si la conciliación falla muestra el error sin perder la fila', async () => {
    mocks.listarPagos.mockResolvedValue({ pagos: [PAGO], total: 1 })
    mocks.conciliarPago.mockRejectedValue({ code: '40001' })
    abrir()

    const interruptor = await screen.findByRole('switch', { name: 'Cobrado 0001-00000001' })
    await waitFor(() => expect(interruptor).toBeEnabled())
    fireEvent.click(interruptor)

    expect(await screen.findByText('No pudimos conciliar el pago. Intentá de nuevo.')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Pagos' })).toBeInTheDocument()
  })

  it('sin pagos muestra el estado vacío del prototipo', async () => {
    mocks.listarPagos.mockResolvedValue({ pagos: [], total: 0 })
    abrir()

    expect(await screen.findByText('Sin pagos para mostrar')).toBeInTheDocument()
    expect(screen.getByText('Cambiá de cuenta o desactivá el filtro de saldo.')).toBeInTheDocument()
  })
})

describe('PagosList · la tarjeta de cuentas de cobro (FR-027)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockAnchoPantalla(false)
    mocks.useFiltroPorEmpresaActiva.mockReturnValue(FILTROS)
    mocks.listarPagos.mockResolvedValue({ pagos: [], total: 0 })
    mocks.resumenPagos.mockResolvedValue(RESUMEN)
    mocks.cuentasCobroMasUsadas.mockResolvedValue(CUENTAS)
    mocks.puedeConciliarPago.mockResolvedValue(true)
  })

  it('muestra el texto de la tarjeta y el total de cuentas cargadas', async () => {
    abrir()

    const tarjeta = (await screen.findByRole('heading', { name: 'Cuentas de cobro' })).closest('.MuiCard-root') as HTMLElement
    expect(within(tarjeta).getByText('3 cargadas · se muestran las más usadas. Las marcadas como No usar no se ofrecen al cargar un comprobante, pero conservan su historial.')).toBeInTheDocument()
  })

  it('muestra cada cuenta con su sub-texto y la marca «No usar»', async () => {
    abrir()

    const tarjeta = (await screen.findByRole('heading', { name: 'Cuentas de cobro' })).closest('.MuiCard-root') as HTMLElement
    expect(within(tarjeta).getByText('Banco Uno')).toBeInTheDocument()
    expect(within(tarjeta).getByText('Galicia · 4 pagos')).toBeInTheDocument()
    expect(within(tarjeta).getByText('Banco No usar')).toBeInTheDocument()
    expect(within(tarjeta).getByText('Santander · 1 pago')).toBeInTheDocument()
    expect(within(tarjeta).getByText('No usar')).toBeInTheDocument()
  })

  it('los botones «Ver todas las cuentas de cobro» y «Nueva cuenta» llevan a la pantalla de cuentas', async () => {
    abrir()

    const tarjeta = (await screen.findByRole('heading', { name: 'Cuentas de cobro' })).closest('.MuiCard-root') as HTMLElement
    expect(within(tarjeta).getByRole('link', { name: 'Ver todas las cuentas de cobro' })).toHaveAttribute('href', '/ventas/cuentas-cobro')
    expect(within(tarjeta).getByRole('link', { name: 'Nueva cuenta' })).toHaveAttribute('href', '/ventas/cuentas-cobro')
  })
})

describe('PagosList · el cambio de empresa activa (FR-028)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockAnchoPantalla(false)
    mocks.useFiltroPorEmpresaActiva.mockReturnValue(FILTROS)
    mocks.listarPagos.mockResolvedValue({ pagos: [PAGO], total: 20 })
    mocks.resumenPagos.mockResolvedValue(RESUMEN)
    mocks.cuentasCobroMasUsadas.mockResolvedValue(CUENTAS)
    mocks.puedeConciliarPago.mockResolvedValue(true)
  })

  it('al cambiar la empresa recarga las tres consultas y reencuadra la paginación', async () => {
    const { rerender } = abrir()
    await waitFor(() => expect(mocks.listarPagos).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente/i }))
    await waitFor(() => expect(ultimoListado().pagina).toBe(2))

    const antes = {
      listado: mocks.listarPagos.mock.calls.length,
      resumen: mocks.resumenPagos.mock.calls.length,
      cuentas: mocks.cuentasCobroMasUsadas.mock.calls.length,
    }

    mocks.useFiltroPorEmpresaActiva.mockReturnValue({ ...FILTROS, valor: 'e-2', empresaActivaId: 'e-2' })
    rerender(<MemoryRouter><PagosList /></MemoryRouter>)

    await waitFor(() => expect(ultimoListado().empresaId).toBe('e-2'))
    expect(ultimoListado().pagina).toBe(1)
    expect(mocks.listarPagos.mock.calls.length).toBeGreaterThan(antes.listado)
    expect(mocks.resumenPagos.mock.calls.length).toBeGreaterThan(antes.resumen)
    expect(mocks.cuentasCobroMasUsadas.mock.calls.length).toBeGreaterThan(antes.cuentas)
  })

  it('al cambiar la empresa descarta el filtro de cuenta que ya no existe', async () => {
    mocks.cuentasCobroMasUsadas.mockImplementation((empresaId: string | null) => Promise.resolve(
      empresaId === 'e-2' ? CUENTAS_OTRA_TIENDA : CUENTAS,
    ))
    const { rerender } = abrir()
    await screen.findByRole('button', { name: 'Banco Uno' })

    fireEvent.click(screen.getByRole('button', { name: 'Banco Uno' }))
    await waitFor(() => expect(ultimoListado().cuentaCobroId).toBe('c-1'))

    mocks.useFiltroPorEmpresaActiva.mockReturnValue({ ...FILTROS, valor: 'e-2', empresaActivaId: 'e-2' })
    rerender(<MemoryRouter><PagosList /></MemoryRouter>)

    await waitFor(() => expect(ultimoListado().empresaId).toBe('e-2'))
    await waitFor(() => expect(ultimoListado().cuentaCobroId).toBeNull())
    // El filtro queda limpio: la píldora «Todas» vuelve a estar elegida.
    expect(screen.getByRole('button', { name: 'Todas' })).toHaveAttribute('aria-pressed', 'true')
  })
})
