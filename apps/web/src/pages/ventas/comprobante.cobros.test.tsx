import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../test/axe'

// La ficha del comprobante tarda cerca de un segundo en pintarse en jsdom (formulario completo,
// catálogo de productos y cliente). Con el límite por defecto de Testing Library (1 s) las
// esperas quedan al borde y la suite se vuelve intermitente según la carga de la máquina: este
// archivo espera con margen. El resto de la suite del repo no cambia.
const ESPERA_PANTALLA = 5000
configure({ asyncUtilTimeout: ESPERA_PANTALLA })
// Mismo margen que las demás pantallas pesadas del repo (el límite de Vitest es de 5 s por
// prueba): sin esto, una máquina cargada hace fallar la primera ficha por tiempo.
vi.setConfig({ testTimeout: 20000 })

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  useNivelSeccion: vi.fn(),
  useEmpresasAccesibles: vi.fn(),
  obtenerComprobante: vi.fn(),
  obtenerClienteParaComprobante: vi.fn(),
  listarFormasPago: vi.fn(),
  useListarCuentasCobro: vi.fn(),
  // Respuestas que la pantalla lee de las RPC de cobros.
  cobros: [] as unknown[],
  saldo: { total: 1000, cobrado: 0, saldo: 1000 },
  puedeRegistrar: true,
}))

vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: mocks.useEmpresasAccesibles }))
vi.mock('../../hooks/useListarCuentasCobro', () => ({ useListarCuentasCobro: mocks.useListarCuentasCobro }))
vi.mock('../../lib/depositos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/depositos')>()),
  listarDepositos: vi.fn(async () => []),
}))
vi.mock('../../lib/ventas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/ventas')>()),
  obtenerComprobante: mocks.obtenerComprobante,
  obtenerClienteParaComprobante: mocks.obtenerClienteParaComprobante,
}))
vi.mock('../../lib/ventas/formasPago', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/ventas/formasPago')>()),
  listarFormasPago: mocks.listarFormasPago,
}))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../components/service/ClienteSelector', () => ({
  ClienteSelector: () => <div data-testid="cliente" />,
}))
// Las tarjetas de Envío y de Despacho (F-VTA-16 y F-VTA-15, MSF-135) también anuncian «Cargando
// contenido» mientras cargan. Esta prueba es de la tarjeta de Cobros: si las otras dos siguen
// cargando, hay tres «Cargando contenido» en pantalla y la búsqueda por rol encuentra más de uno
// (depende de la carga de la máquina). Se sustituyen para que el único «Cargando contenido» sea el
// de Cobros, que es lo que la prueba mide. Sus pruebas viven en su propio archivo.
vi.mock('../../components/ventas/EnvioTransporte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../components/ventas/EnvioTransporte')>()),
  EnvioTransporte: () => null,
}))
vi.mock('../../components/ventas/ResponsablesDespacho', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../components/ventas/ResponsablesDespacho')>()),
  ResponsablesDespacho: () => null,
}))
// El historial del comprobante también anuncia «Cargando contenido» mientras carga: se sustituye por
// la misma razón. Sus pruebas viven en su propio archivo.
vi.mock('../../components/ventas/HistorialComprobante', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../components/ventas/HistorialComprobante')>()),
  HistorialComprobante: () => null,
}))

import {
  aParametrosRegistrar,
  cobrosDeComprobante,
  codigoDeErrorCobro,
  errorDeCampoCobro,
  FORMULARIO_COBRO_VACIO,
  mensajeDeErrorCobro,
  parsearImporteCobro,
  registrarCobro,
  saldoComprobante,
  validarCobro,
} from '../../lib/ventas/cobros'
import type { Comprobante } from '../../lib/ventas'
import { ComprobanteVenta } from './comprobante'

const FORMULARIO = {
  forma_pago_id: 'f-2',
  cuenta_cobro_id: 'c-1',
  importe: '400,50',
}

describe('parsearImporteCobro', () => {
  it('acepta «400» y «400,50»', () => {
    expect(parsearImporteCobro('400')).toBe(400)
    expect(parsearImporteCobro(' 400,50 ')).toBe(400.5)
  })

  it('rechaza lo que la base no acepta: letras, miles y más de dos decimales', () => {
    expect(parsearImporteCobro('400,555')).toBeNull()
    expect(parsearImporteCobro('1.000')).toBeNull()
    expect(parsearImporteCobro('cuatrocientos')).toBeNull()
    expect(parsearImporteCobro('-50')).toBeNull()
    expect(parsearImporteCobro('')).toBeNull()
  })
})

describe('validarCobro', () => {
  it('acepta un cobro válido', () => {
    expect(validarCobro(FORMULARIO, { saldo: 1000, exigeCuenta: true })).toEqual({})
  })

  it('pide la forma de pago', () => {
    expect(validarCobro({ ...FORMULARIO, forma_pago_id: '' }, { saldo: 1000, exigeCuenta: false }).forma_pago_id).toBeDefined()
  })

  it('pide la cuenta de cobro solo cuando la forma la exige', () => {
    expect(validarCobro({ ...FORMULARIO, cuenta_cobro_id: '' }, { saldo: 1000, exigeCuenta: true }).cuenta_cobro_id).toBeDefined()
    expect(validarCobro({ ...FORMULARIO, cuenta_cobro_id: '' }, { saldo: 1000, exigeCuenta: false }).cuenta_cobro_id).toBeUndefined()
  })

  it('pide el importe y lo valida como número mayor a cero', () => {
    expect(validarCobro(FORMULARIO_COBRO_VACIO, { saldo: 1000, exigeCuenta: false }).importe).toBeDefined()
    expect(validarCobro({ ...FORMULARIO, importe: 'cero' }, { saldo: 1000, exigeCuenta: false }).importe).toBeDefined()
    expect(validarCobro({ ...FORMULARIO, importe: '0' }, { saldo: 1000, exigeCuenta: false }).importe).toBeDefined()
    expect(validarCobro({ ...FORMULARIO, importe: '400,555' }, { saldo: 1000, exigeCuenta: false }).importe).toBeDefined()
  })

  it('no deja pasar un importe mayor al saldo pendiente', () => {
    const errores = validarCobro({ ...FORMULARIO, importe: '1000,01' }, { saldo: 1000, exigeCuenta: false })
    expect(errores.importe).toContain('saldo')
    // El saldo del mensaje va formateado como el resto de la pantalla: sin miles ni decimales
    // ambiguos («1000.5» se lee como mil punto cinco).
    expect(errores.importe).toBe('El importe no puede superar el saldo pendiente ($ 1.000).')
    expect(validarCobro({ ...FORMULARIO, importe: '1000' }, { saldo: 1000, exigeCuenta: false }).importe).toBeUndefined()
  })
})

describe('aParametrosRegistrar', () => {
  it('manda el importe como número y los vacíos como null', () => {
    expect(aParametrosRegistrar('k-1', FORMULARIO)).toEqual({
      p_comprobante_id: 'k-1',
      p_importe: 400.5,
      p_forma_pago_id: 'f-2',
      p_cuenta_cobro_id: 'c-1',
      p_actualizado_en: null,
    })
    expect(aParametrosRegistrar('k-1', { ...FORMULARIO, cuenta_cobro_id: ' ' }).p_cuenta_cobro_id).toBeNull()
  })

  it('no manda un importe que no es número', () => {
    expect(() => aParametrosRegistrar('k-1', { ...FORMULARIO, importe: 'cero' })).toThrow(/número/)
  })
})

describe('llamadas a la base', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rpc.mockResolvedValue({ data: null, error: null })
  })

  it('registrar, listar y consultar el saldo llaman a su RPC', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { id: 'b-1', importe: 400.5 }, error: null })
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null })
    mocks.rpc.mockResolvedValueOnce({ data: [{ total: 1000, cobrado: 400.5, saldo: 599.5 }], error: null })
    await registrarCobro('k-1', FORMULARIO)
    await cobrosDeComprobante('k-1')
    await saldoComprobante('k-1')

    expect(mocks.rpc.mock.calls.map(([nombre]) => nombre)).toEqual([
      'registrar_cobro',
      'cobros_de_comprobante',
      'saldo_comprobante',
    ])
    expect(mocks.rpc).toHaveBeenCalledWith('cobros_de_comprobante', { p_comprobante_id: 'k-1' })
    expect(mocks.rpc).toHaveBeenCalledWith('saldo_comprobante', { p_id: 'k-1' })
    expect(mocks.rpc).toHaveBeenCalledWith('registrar_cobro', {
      p_comprobante_id: 'k-1',
      p_importe: 400.5,
      p_forma_pago_id: 'f-2',
      p_cuenta_cobro_id: 'c-1',
      p_actualizado_en: null,
    })
  })

  it('el importe del cobro y el de la lista llegan como número', async () => {
    mocks.rpc.mockResolvedValue({ data: { id: 'b-1', importe: '400.50' }, error: null })
    expect((await registrarCobro('k-1', FORMULARIO)).importe).toBe(400.5)

    mocks.rpc.mockResolvedValue({
      data: [{ id: 'b-1', fecha: '2026-12-01', forma_pago: 'Transferencia', cuenta_cobro: 'Banco Uno', importe: '400.50', origen: 'manual', conciliado: false, aprobado_por: null, registrado_por: 'mostrador-uno@example.com' }],
      error: null,
    })
    const cobros = await cobrosDeComprobante('k-1')
    expect(cobros[0].importe).toBe(400.5)
    expect(cobros[0].forma_pago).toBe('Transferencia')
  })

  it('propaga el error de la base para que la pantalla lo muestre', async () => {
    const error = { code: 'P0001', message: 'x' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(registrarCobro('k-1', FORMULARIO)).rejects.toBe(error)
    await expect(cobrosDeComprobante('k-1')).rejects.toBe(error)
    await expect(saldoComprobante('k-1')).rejects.toBe(error)
  })
})

describe('errores de la base', () => {
  it('el hint dice qué campo marcar', () => {
    expect(errorDeCampoCobro({ code: '22023', hint: 'importe', message: 'El importe tiene que ser mayor a cero' })).toEqual({
      campo: 'importe',
      mensaje: 'El importe tiene que ser mayor a cero',
    })
    expect(errorDeCampoCobro({ code: '22023', hint: 'cuenta_cobro_id', message: 'La forma de pago exige una cuenta de cobro' })?.campo).toBe('cuenta_cobro_id')
    expect(errorDeCampoCobro({ code: '42501', message: 'x' })).toBeNull()
    expect(errorDeCampoCobro({ code: '22023', message: 'sin hint' })).toBeNull()
  })

  it('el tope (P0001) también trae el hint del campo: el importe', () => {
    // La RPC `registrar_cobro` re-lanza el tope con `hint = 'importe'` (y el pgTAP lo comprueba):
    // si la pantalla lo ignorara, el error caería como aviso general y se perdería el mensaje de
    // la base, que dice cuál es el saldo.
    expect(
      errorDeCampoCobro({
        code: 'P0001',
        hint: 'importe',
        message: 'El importe supera el saldo pendiente: el saldo es 600 y el importe es 700',
      }),
    ).toEqual({
      campo: 'importe',
      mensaje: 'El importe supera el saldo pendiente: el saldo es 600 y el importe es 700',
    })
    // Sin hint (otra vía de escritura) no hay campo: el mensaje es general.
    expect(errorDeCampoCobro({ code: 'P0001', message: 'saldo insuficiente' })).toBeNull()
  })

  it('traduce los códigos a castellano sin filtrar el mensaje crudo', () => {
    expect(mensajeDeErrorCobro({ code: '42501' }, 'x')).toContain('permiso')
    expect(mensajeDeErrorCobro({ code: 'P0002' }, 'x')).toContain('no existe')
    expect(mensajeDeErrorCobro({ code: 'P0001' }, 'x')).toContain('saldo')
    expect(mensajeDeErrorCobro({ code: '55000' }, 'x')).toContain('no admite cobros')
    expect(mensajeDeErrorCobro({ code: '22023', message: 'El importe tiene que ser mayor a cero' }, 'x')).toBe('El importe tiene que ser mayor a cero')
    expect(mensajeDeErrorCobro({ code: 'XX000', message: 'detalle técnico' }, 'No pudimos registrar el cobro')).toBe('No pudimos registrar el cobro')
  })

  // Cierre de la épica (T032): el detalle crudo de Postgres puede nombrar políticas o tablas, y
  // una fila que falló un check puede traer los datos de la cuenta de cobro: a la consola va
  // solo el código.
  it('la consola recibe solo el código del error, no el detalle crudo', () => {
    const cbu = '2850591612345678901233'
    expect(codigoDeErrorCobro({ code: '23514', message: 'check violation', details: `Failing row contains (${cbu})` })).toBe('23514')
    expect(codigoDeErrorCobro({ code: '42501', message: 'x', details: 'policy ventas_select' })).toBe('42501')
    expect(codigoDeErrorCobro(new Error('falló el catálogo'))).toBe('sin código')
  })
})

// ============================================================================
// Tarjeta Cobros, diálogo «Registrar cobro», campo «Cuenta de cobro» y el
// cambio de empresa activa (F-VTA-12, FR-007, FR-008 y FR-009).
// ============================================================================

const EMPRESAS = [
  { id: 'e-1', nombre: 'San Javucho', esActiva: true },
  { id: 'e-2', nombre: 'Mundo JC', esActiva: false },
]

// Promesa que el caso resuelve a mano: sirve para observar la pantalla mientras una consulta
// está en vuelo y para hacer llegar tarde una respuesta vieja.
function diferido<T>() {
  let resolver!: (valor: T) => void
  const promesa = new Promise<T>((resolverPromesa) => {
    resolver = resolverPromesa
  })
  return { promesa, resolver }
}

const accesibles = (activa: string | null) => ({
  empresas: EMPRESAS.map((empresa) => ({ ...empresa, esActiva: empresa.id === activa })),
  empresaActivaId: activa,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
})

const COMPROBANTE: Comprobante = {
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
  total_con_iva: 1000,
  editable: false,
  puede_editar: false,
  puede_editar_precio: false,
  updated_at: '2026-10-24T10:00:00Z',
}

const COBRO = {
  id: 'b-1',
  fecha: '2026-12-01T10:00:00Z',
  forma_pago: 'Transferencia',
  forma_pago_tipo: 'transferencia',
  cuenta_cobro: 'Banco Uno',
  cuenta_cobro_banco: 'Banco Uno',
  cuenta_cobro_titular: 'Comercial Ejemplo SRL',
  importe: 400,
  origen: 'manual' as const,
  conciliado: false,
  aprobado_por: null,
  registrado_por: 'mostrador-uno@example.com',
}

const CUENTAS = [
  {
    id: 'c-1',
    nombre: 'Banco Uno',
    titular: 'Comercial Ejemplo SRL',
    banco: 'Banco Uno',
    cbu: '0170099220000067797370',
    cuit: '30-12345678-9',
    alias: null,
    tipo: 'cuenta_corriente' as const,
    moneda: 'ARS' as const,
    orden: 1,
    activa: true,
    notas: null,
    updated_at: '2026-10-24T10:00:00Z',
    empresas: [{ id: 'e-1', nombre: 'San Javucho' }],
  },
]

const FORMAS = [
  { id: 'f-1', empresa_id: 'e-1', nombre: 'Efectivo', tipo: 'efectivo' as const, exige_cuenta_cobro: false, genera_deuda: false, estado_inicial: 'pendiente' as const, orden: 1, activo: true, updated_at: '2026-10-24T10:00:00Z' },
  { id: 'f-2', empresa_id: 'e-1', nombre: 'Transferencia', tipo: 'transferencia' as const, exige_cuenta_cobro: true, genera_deuda: false, estado_inicial: 'pendiente' as const, orden: 2, activo: true, updated_at: '2026-10-24T10:00:00Z' },
]

// Una forma de pago que genera deuda: la factura queda «Deuda» en vez de «Cobrado» (FR-004).
const FORMAS_CON_DEUDA = [
  ...FORMAS,
  { id: 'f-3', empresa_id: 'e-1', nombre: 'Crédito del proveedor', tipo: 'otro' as const, exige_cuenta_cobro: false, genera_deuda: true, estado_inicial: 'pendiente' as const, orden: 3, activo: true, updated_at: '2026-10-24T10:00:00Z' },
]

function UbicacionActual() {
  const ubicacion = useLocation()
  return <div>{`En ${ubicacion.pathname}`}</div>
}

const arbol = (ruta: string) => (
  <MemoryRouter initialEntries={[ruta]}>
    <Routes>
      <Route path="/ventas/comprobantes/:id" element={<ComprobanteVenta />} />
      <Route path="/ventas/comprobantes" element={<UbicacionActual />} />
      <Route path="/ventas/pagos" element={<div>Pagos</div>} />
    </Routes>
  </MemoryRouter>
)

// Llamadas a cada RPC de cobros: sirve para contar cuántas veces se consultó.
const llamadas = (nombre: string) => mocks.rpc.mock.calls.filter(([rpc]) => rpc === nombre).length

beforeEach(() => {
  vi.clearAllMocks()
  // `mockReset` (y no `clearAllMocks`) descarta también las respuestas «una vez» encoladas por
  // los casos de la lib: si quedaran, la primera consulta de la pantalla los consumería.
  mocks.rpc.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
  mocks.useEmpresasAccesibles.mockReturnValue(accesibles('e-1'))
  mocks.obtenerComprobante.mockResolvedValue(COMPROBANTE)
  mocks.obtenerClienteParaComprobante.mockResolvedValue(null)
  mocks.listarFormasPago.mockResolvedValue(FORMAS)
  mocks.useListarCuentasCobro.mockReturnValue({
    cuentas: CUENTAS,
    total: CUENTAS.length,
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  })
  mocks.cobros = []
  mocks.saldo = { total: 1000, cobrado: 0, saldo: 1000 }
  mocks.puedeRegistrar = true
  // La pantalla lee las RPC por nombre: cada una responde con lo que el caso necesita.
  mocks.rpc.mockImplementation(async (nombre: string) => {
    switch (nombre) {
      case 'cobros_de_comprobante':
        return { data: mocks.cobros, error: null }
      case 'saldo_comprobante':
        return { data: [mocks.saldo], error: null }
      case 'puede_registrar_cobro':
        return { data: mocks.puedeRegistrar, error: null }
      case 'registrar_cobro':
        return { data: { id: 'b-9', importe: 400 }, error: null }
      // Las transiciones del estado y el cambio: la base los decide (MSF-715).
      case 'transiciones_permitidas_comprobante':
        return { data: ['en_proceso'], error: null }
      case 'cambiar_estado_comprobante':
        return { data: { estado: 'en_proceso', updated_at: '2027-01-03T00:00:00Z' }, error: null }
      default:
        return { data: null, error: null }
    }
  })
})

describe('Detalle del comprobante · tarjeta Cobros (F-VTA-12, FR-007)', () => {
  it('muestra lo cobrado, lo que falta y el detalle de cada cobro', async () => {
    mocks.cobros = [COBRO]
    mocks.saldo = { total: 1000, cobrado: 400, saldo: 600 }
    render(arbol('/ventas/comprobantes/k-1'))

    expect(await screen.findByRole('heading', { name: 'Cobros' })).toBeInTheDocument()
    const totales = await screen.findByRole('group', { name: 'Totales de los cobros' })
    expect(within(totales).getByText('Cobrado')).toBeInTheDocument()
    expect(within(totales).getByText('$ 400')).toBeInTheDocument()
    expect(within(totales).getByText('Saldo')).toBeInTheDocument()
    expect(within(totales).getByText('$ 600')).toBeInTheDocument()

    const tabla = screen.getByRole('table', { name: 'Cobros del comprobante' })
    const fila = within(tabla).getAllByRole('row')[1]
    expect(within(fila).getByText('01/12/2026')).toBeInTheDocument()
    expect(within(fila).getByText('Transferencia')).toBeInTheDocument()
    expect(within(fila).getByText('Banco Uno · Comercial Ejemplo SRL')).toBeInTheDocument()
    expect(within(fila).getByText('$ 400')).toBeInTheDocument()
    expect(within(fila).getByText('mostrador-uno@example.com')).toBeInTheDocument()
  })

  it('sin cobros muestra el estado vacío del kit', async () => {
    render(arbol('/ventas/comprobantes/k-1'))
    expect(await screen.findByText('Todavía no hay cobros')).toBeInTheDocument()
  })

  it('mientras carga anuncia «Cargando contenido» y no muestra un vacío falso', async () => {
    const cobrosPendientes = diferido<{ data: unknown; error: null }>()
    mocks.rpc.mockImplementation((nombre: string) => {
      if (nombre === 'cobros_de_comprobante') return cobrosPendientes.promesa
      if (nombre === 'saldo_comprobante') return Promise.resolve({ data: [mocks.saldo], error: null })
      if (nombre === 'puede_registrar_cobro') return Promise.resolve({ data: true, error: null })
      return Promise.resolve({ data: null, error: null })
    })
    render(arbol('/ventas/comprobantes/k-1'))

    // La tarjeta ya está, pero la consulta sigue en vuelo: no se anuncia «sin cobros» ni se
    // ofrece registrar con un saldo que todavía se desconoce.
    expect(await screen.findByRole('heading', { name: 'Cobros' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
    expect(screen.queryByText('Todavía no hay cobros')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Registrar cobro' })).not.toBeInTheDocument()

    await act(async () => {
      cobrosPendientes.resolver({ data: [], error: null })
    })

    expect(await screen.findByText('Todavía no hay cobros')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Cargando contenido' })).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Registrar cobro' })).toBeInTheDocument()
  })

  it('si la lectura falla, muestra el error con «Reintentar» y vuelve a consultar', async () => {
    mocks.rpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'cobros_de_comprobante') return { data: null, error: { code: 'XX000', message: 'detalle técnico' } }
      if (nombre === 'saldo_comprobante') return { data: [{ total: 1000, cobrado: 0, saldo: 1000 }], error: null }
      if (nombre === 'puede_registrar_cobro') return { data: true, error: null }
      return { data: null, error: null }
    })
    render(arbol('/ventas/comprobantes/k-1'))

    expect(await screen.findByText('No pudimos cargar los cobros de la factura. Reintentá.')).toBeInTheDocument()
    const antes = llamadas('cobros_de_comprobante')
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(llamadas('cobros_de_comprobante')).toBe(antes + 1))
  })

  // Con la lectura en error el saldo es desconocido: no se ofrece la acción (deny-by-default),
  // porque el diálogo abriría con «Saldo pendiente: $ 0» y no dejaría cobrar nada. La pantalla
  // no ofrece acciones que van a fallar; «Reintentar» está en la tarjeta.
  it('si la lectura falla, no ofrece «Registrar cobro» porque el saldo es desconocido', async () => {
    mocks.rpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'cobros_de_comprobante') return { data: null, error: { code: 'XX000', message: 'detalle técnico' } }
      if (nombre === 'saldo_comprobante') return { data: [{ total: 1000, cobrado: 0, saldo: 1000 }], error: null }
      if (nombre === 'puede_registrar_cobro') return { data: true, error: null }
      return { data: null, error: null }
    })
    render(arbol('/ventas/comprobantes/k-1'))

    expect(await screen.findByText('No pudimos cargar los cobros de la factura. Reintentá.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Registrar cobro' })).not.toBeInTheDocument()
  })

  it('sin la acción `registrar_cobro` el botón no aparece', async () => {
    mocks.puedeRegistrar = false
    render(arbol('/ventas/comprobantes/k-1'))

    expect(await screen.findByRole('heading', { name: 'Cobros' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Registrar cobro' })).not.toBeInTheDocument()
  })

  // Un cobro solo se registra sobre una factura confirmada y no anulada: la base rechaza el
  // resto (FR-002, escenario 5 de US1) y la pantalla no ofrece una acción que va a fallar.
  it.each([
    ['un presupuesto', { ...COMPROBANTE, tipo: 'presupuesto' as const }],
    ['una factura en borrador', { ...COMPROBANTE, estado: 'borrador' }],
    ['una factura anulada', { ...COMPROBANTE, estado: 'anulada' }],
  ])('no ofrece «Registrar cobro» en %s', async (_caso, comprobante) => {
    mocks.obtenerComprobante.mockResolvedValue(comprobante)
    render(arbol('/ventas/comprobantes/k-1'))

    expect(await screen.findByRole('heading', { name: 'Cobros' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Registrar cobro' })).not.toBeInTheDocument()
    expect(mocks.rpc.mock.calls.filter(([nombre]) => nombre === 'registrar_cobro')).toHaveLength(0)
  })

  it('con la acción, abre el diálogo con forma de pago, cuenta de cobro e importe sugerido por el saldo', async () => {
    render(arbol('/ventas/comprobantes/k-1'))
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar cobro' }))

    const dialogo = await screen.findByRole('dialog')
    expect(within(dialogo).getByRole('combobox', { name: 'Forma de pago' })).toBeInTheDocument()
    expect(within(dialogo).getByRole('combobox', { name: 'Cuenta de cobro' })).toBeInTheDocument()
    expect(within(dialogo).getByRole('textbox', { name: 'Importe' })).toHaveValue('1000')
    expect(within(dialogo).getByText('Saldo pendiente: $ 1.000')).toBeInTheDocument()
  })

  it('exige la forma de pago, la cuenta cuando la forma la pide y un importe válido', async () => {
    render(arbol('/ventas/comprobantes/k-1'))
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar cobro' }))
    const dialogo = await screen.findByRole('dialog')

    fireEvent.change(within(dialogo).getByRole('textbox', { name: 'Importe' }), { target: { value: '' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar cobro' }))

    expect(await within(dialogo).findByText('Elegí la forma de pago.')).toBeInTheDocument()
    expect(within(dialogo).getByText('Ingresá el importe del cobro.')).toBeInTheDocument()
    expect(mocks.rpc.mock.calls.filter(([nombre]) => nombre === 'registrar_cobro')).toHaveLength(0)
  })

  it('la forma de pago que exige cuenta pide la cuenta y avisa en el campo', async () => {
    render(arbol('/ventas/comprobantes/k-1'))
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar cobro' }))
    const dialogo = await screen.findByRole('dialog')

    fireEvent.mouseDown(within(dialogo).getByRole('combobox', { name: 'Forma de pago' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Transferencia' }))
    expect(within(dialogo).getByText('La forma de pago elegida exige una cuenta de cobro.')).toBeInTheDocument()

    fireEvent.change(within(dialogo).getByRole('textbox', { name: 'Importe' }), { target: { value: '400' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar cobro' }))

    expect(await within(dialogo).findByText('La forma de pago exige una cuenta de cobro.')).toBeInTheDocument()
    expect(mocks.rpc.mock.calls.filter(([nombre]) => nombre === 'registrar_cobro')).toHaveLength(0)
  })

  it('no deja registrar un importe mayor al saldo', async () => {
    render(arbol('/ventas/comprobantes/k-1'))
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar cobro' }))
    const dialogo = await screen.findByRole('dialog')

    fireEvent.change(within(dialogo).getByRole('textbox', { name: 'Importe' }), { target: { value: '1500' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar cobro' }))

    expect(await within(dialogo).findByText(/no puede superar el saldo pendiente/)).toBeInTheDocument()
    expect(within(dialogo).getByText('El importe no puede superar el saldo pendiente ($ 1.000).')).toBeInTheDocument()
    expect(mocks.rpc.mock.calls.filter(([nombre]) => nombre === 'registrar_cobro')).toHaveLength(0)
  })

  it('registra el cobro, avisa y recarga la lista', async () => {
    render(arbol('/ventas/comprobantes/k-1'))
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar cobro' }))
    const dialogo = await screen.findByRole('dialog')

    fireEvent.mouseDown(within(dialogo).getByRole('combobox', { name: 'Forma de pago' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Transferencia' }))
    fireEvent.mouseDown(within(dialogo).getByRole('combobox', { name: 'Cuenta de cobro' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Banco Uno · Comercial Ejemplo SRL' }))
    fireEvent.change(within(dialogo).getByRole('textbox', { name: 'Importe' }), { target: { value: '400' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar cobro' }))

    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('registrar_cobro', {
        p_comprobante_id: 'k-1',
        p_importe: 400,
        p_forma_pago_id: 'f-2',
        p_cuenta_cobro_id: 'c-1',
        p_actualizado_en: null,
      }),
    )
    expect(await screen.findByText('Cobro registrado · $ 400')).toBeInTheDocument()
    await waitFor(() => expect(llamadas('cobros_de_comprobante')).toBeGreaterThan(1))
  })

  // MSF-715: tras registrar un cobro la base cambia el estado y el `updated_at` del comprobante. La
  // pantalla tiene que releerlo: si no, el detalle queda viejo (dice «Pendiente» cuando la base dice
  // «Cobrado») y la acción siguiente choca con «Otra persona modificó este comprobante».
  describe('MSF-715 · el detalle se relee después del cobro', () => {
    const COBRADO = { ...COMPROBANTE, estado: 'cobrado', updated_at: '2027-01-02T00:00:00Z' }
    const DEUDA = { ...COMPROBANTE, estado: 'deuda', updated_at: '2027-01-02T00:00:00Z' }

    // Registra un cobro por el saldo entero y deja el diálogo listo. Con `fallo` el diálogo queda
    // abierto (el error se muestra adentro); si no, se espera a que se cierre: mientras el modal
    // está montado el resto de la pantalla queda `aria-hidden` y no se puede leer con el lector.
    const registrarCobro = async (forma = 'Transferencia', fallo = false) => {
      fireEvent.click(await screen.findByRole('button', { name: 'Registrar cobro' }))
      const dialogo = await screen.findByRole('dialog')
      fireEvent.mouseDown(within(dialogo).getByRole('combobox', { name: 'Forma de pago' }))
      fireEvent.click(await screen.findByRole('option', { name: forma }))
      if (forma === 'Transferencia') {
        fireEvent.mouseDown(within(dialogo).getByRole('combobox', { name: 'Cuenta de cobro' }))
        fireEvent.click(await screen.findByRole('option', { name: 'Banco Uno · Comercial Ejemplo SRL' }))
      }
      fireEvent.change(within(dialogo).getByRole('textbox', { name: 'Importe' }), { target: { value: '1000' } })
      fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar cobro' }))
      if (!fallo) await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      return dialogo
    }

    const tarjetaEstado = () => within(screen.getByRole('region', { name: 'Estado' }))

    it('el estado visible pasa a «Cobrado» y la acción siguiente manda el `updated_at` nuevo', async () => {
      render(arbol('/ventas/comprobantes/k-1'))
      await waitFor(() => expect(mocks.obtenerComprobante).toHaveBeenCalledTimes(1))
      // La base deja la factura cobrada y avanza `updated_at`: la próxima lectura lo trae.
      mocks.obtenerComprobante.mockResolvedValue(COBRADO)

      await registrarCobro()

      await waitFor(() => expect(mocks.obtenerComprobante).toHaveBeenCalledTimes(2))
      expect(tarjetaEstado().getByRole('button', { name: 'Cobrado' })).toBeInTheDocument()

      // La acción siguiente (cambiar el estado) manda el `updated_at` vigente: con el viejo la base
      // respondería «Otra persona modificó este comprobante».
      fireEvent.click(tarjetaEstado().getByRole('button', { name: 'En proceso' }))
      await waitFor(() =>
        expect(mocks.rpc).toHaveBeenCalledWith('cambiar_estado_comprobante', {
          p_id: 'k-1',
          p_estado: 'en_proceso',
          p_actualizado_en: '2027-01-02T00:00:00Z',
        }),
      )
    })

    it('con una forma de pago que genera deuda el estado visible pasa a «Deuda»', async () => {
      mocks.listarFormasPago.mockResolvedValue(FORMAS_CON_DEUDA)
      render(arbol('/ventas/comprobantes/k-1'))
      await waitFor(() => expect(mocks.obtenerComprobante).toHaveBeenCalledTimes(1))
      mocks.obtenerComprobante.mockResolvedValue(DEUDA)

      await registrarCobro('Crédito del proveedor')

      await waitFor(() => expect(mocks.obtenerComprobante).toHaveBeenCalledTimes(2))
      expect(tarjetaEstado().getByRole('button', { name: 'Deuda' })).toBeInTheDocument()
    })

    it('si el cobro falla no se relee el comprobante', async () => {
      mocks.rpc.mockImplementation(async (nombre: string) => {
        if (nombre === 'registrar_cobro') {
          return { data: null, error: { code: '42501', message: 'sin permiso' } }
        }
        if (nombre === 'cobros_de_comprobante') return { data: mocks.cobros, error: null }
        if (nombre === 'saldo_comprobante') return { data: [mocks.saldo], error: null }
        if (nombre === 'puede_registrar_cobro') return { data: true, error: null }
        return { data: null, error: null }
      })
      render(arbol('/ventas/comprobantes/k-1'))
      await waitFor(() => expect(mocks.obtenerComprobante).toHaveBeenCalledTimes(1))

      await registrarCobro('Transferencia', true)

      expect(
        await screen.findByText(/No tenés permiso para registrar cobros en esta tienda/),
      ).toBeInTheDocument()
      // El cobro no se registró: el comprobante queda como estaba y no se relee.
      expect(mocks.obtenerComprobante).toHaveBeenCalledTimes(1)
    })

    it('el «Reintentar» de la tarjeta de Cobros no pisa lo que se está editando', async () => {
      // Una factura editable (en borrador): el formulario tiene datos sin guardar.
      mocks.obtenerComprobante.mockResolvedValue({
        ...COMPROBANTE,
        estado: 'borrador',
        editable: true,
        puede_editar: true,
      })
      let lecturas = 0
      mocks.rpc.mockImplementation(async (nombre: string) => {
        if (nombre === 'cobros_de_comprobante') {
          lecturas += 1
          return lecturas === 1
            ? { data: null, error: { code: 'XX000', message: 'detalle técnico' } }
            : { data: [], error: null }
        }
        if (nombre === 'saldo_comprobante') return { data: [mocks.saldo], error: null }
        if (nombre === 'puede_registrar_cobro') return { data: true, error: null }
        return { data: null, error: null }
      })
      render(arbol('/ventas/comprobantes/k-1'))

      expect(await screen.findByText('No pudimos cargar los cobros de la factura. Reintentá.')).toBeInTheDocument()
      const fecha = screen.getByLabelText(/^Fecha/)
      fireEvent.change(fecha, { target: { value: '2026-12-31' } })
      expect(fecha).toHaveValue('2026-12-31')

      fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

      await waitFor(() => expect(llamadas('cobros_de_comprobante')).toBe(2))
      // El reintento recarga solo los cobros: el comprobante no se relee (si se releyera, el
      // formulario volvería al valor guardado y la edición se perdería en silencio).
      expect(mocks.obtenerComprobante).toHaveBeenCalledTimes(1)
      expect(screen.getByLabelText(/^Fecha/)).toHaveValue('2026-12-31')
    })

    it('si la relectura después del cobro falla, la pantalla no muestra el error general', async () => {
      render(arbol('/ventas/comprobantes/k-1'))
      await waitFor(() => expect(mocks.obtenerComprobante).toHaveBeenCalledTimes(1))
      mocks.obtenerComprobante.mockRejectedValueOnce(new Error('sin red'))

      await registrarCobro()

      // El cobro quedó registrado: la pantalla sigue mostrando el detalle y avisa que hay que recargar.
      expect(await screen.findByRole('heading', { name: 'Cobros' })).toBeInTheDocument()
      expect(
        await screen.findByText(/El cobro quedó registrado, pero no pudimos actualizar el detalle/),
      ).toBeInTheDocument()
      expect(screen.queryByText('No pudimos cargar el comprobante.')).not.toBeInTheDocument()
    })

    it('mientras relee el comprobante, la tarjeta de Estado queda bloqueada', async () => {
      const pendiente = diferido<Comprobante>()
      render(arbol('/ventas/comprobantes/k-1'))
      await waitFor(() => expect(mocks.obtenerComprobante).toHaveBeenCalledTimes(1))
      // La relectura queda en vuelo: en esa ventana el `updated_at` de la pantalla es el viejo.
      mocks.obtenerComprobante.mockReturnValueOnce(pendiente.promesa)

      await registrarCobro()

      await waitFor(() => expect(mocks.obtenerComprobante).toHaveBeenCalledTimes(2))
      expect(tarjetaEstado().getByRole('button', { name: 'En proceso' })).toBeDisabled()

      await act(async () => {
        pendiente.resolver(COBRADO)
      })
      await waitFor(() =>
        expect(tarjetaEstado().getByRole('button', { name: 'En proceso' })).not.toBeDisabled(),
      )
    })
  })

  it('un error de la base se muestra en el campo que nombra', async () => {
    mocks.rpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'registrar_cobro') {
        return { data: null, error: { code: '22023', hint: 'importe', message: 'El importe no puede superar el saldo pendiente (600).' } }
      }
      if (nombre === 'cobros_de_comprobante') return { data: mocks.cobros, error: null }
      if (nombre === 'saldo_comprobante') return { data: [mocks.saldo], error: null }
      if (nombre === 'puede_registrar_cobro') return { data: true, error: null }
      return { data: null, error: null }
    })
    render(arbol('/ventas/comprobantes/k-1'))
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar cobro' }))
    const dialogo = await screen.findByRole('dialog')

    fireEvent.mouseDown(within(dialogo).getByRole('combobox', { name: 'Forma de pago' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Transferencia' }))
    fireEvent.mouseDown(within(dialogo).getByRole('combobox', { name: 'Cuenta de cobro' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Banco Uno · Comercial Ejemplo SRL' }))
    fireEvent.change(within(dialogo).getByRole('textbox', { name: 'Importe' }), { target: { value: '400' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar cobro' }))

    expect(await within(dialogo).findByText('El importe no puede superar el saldo pendiente (600).')).toBeInTheDocument()
  })

  it('si la base rechaza por el tope, el error queda en el campo Importe', async () => {
    // Es lo que manda la RPC `registrar_cobro`: el tope llega como P0001 con `hint = 'importe'`
    // (el pgTAP lo comprueba). El error tiene que quedar en el campo, no como aviso general.
    mocks.rpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'registrar_cobro') {
        return {
          data: null,
          error: {
            code: 'P0001',
            hint: 'importe',
            message: 'El importe supera el saldo pendiente: el saldo es 600 y el importe es 700',
          },
        }
      }
      if (nombre === 'cobros_de_comprobante') return { data: mocks.cobros, error: null }
      if (nombre === 'saldo_comprobante') return { data: [mocks.saldo], error: null }
      if (nombre === 'puede_registrar_cobro') return { data: true, error: null }
      return { data: null, error: null }
    })
    render(arbol('/ventas/comprobantes/k-1'))
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar cobro' }))
    const dialogo = await screen.findByRole('dialog')

    fireEvent.mouseDown(within(dialogo).getByRole('combobox', { name: 'Forma de pago' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Efectivo' }))
    fireEvent.change(within(dialogo).getByRole('textbox', { name: 'Importe' }), { target: { value: '700' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar cobro' }))

    const importe = within(dialogo).getByRole('textbox', { name: 'Importe' })
    await within(dialogo).findByText('El importe supera el saldo pendiente: el saldo es 600 y el importe es 700')
    expect(importe).toHaveAttribute('aria-invalid', 'true')
    expect(importe).toHaveAccessibleDescription('El importe supera el saldo pendiente: el saldo es 600 y el importe es 700')
    // No es un error general: el mensaje de la base no se muestra como aviso del diálogo.
    expect(within(dialogo).queryByText('No se registró el cobro.')).not.toBeInTheDocument()
  })

  it('si la base rechaza por permiso, el diálogo lo dice en castellano', async () => {
    mocks.rpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'registrar_cobro') {
        return { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } }
      }
      if (nombre === 'cobros_de_comprobante') return { data: mocks.cobros, error: null }
      if (nombre === 'saldo_comprobante') return { data: [mocks.saldo], error: null }
      if (nombre === 'puede_registrar_cobro') return { data: true, error: null }
      return { data: null, error: null }
    })
    render(arbol('/ventas/comprobantes/k-1'))
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar cobro' }))
    const dialogo = await screen.findByRole('dialog')

    fireEvent.mouseDown(within(dialogo).getByRole('combobox', { name: 'Forma de pago' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Efectivo' }))
    fireEvent.change(within(dialogo).getByRole('textbox', { name: 'Importe' }), { target: { value: '400' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar cobro' }))

    expect(
      await within(dialogo).findByText('No tenés permiso para registrar cobros en esta tienda. Puede que tu rol haya cambiado: recargá la página.'),
    ).toBeInTheDocument()
    // El texto técnico de la base no se muestra.
    expect(within(dialogo).queryByText(/row-level security/)).not.toBeInTheDocument()
  })

  it('si la base rechaza por saldo, el diálogo lo dice sin el detalle técnico', async () => {
    mocks.rpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'registrar_cobro') {
        return { data: null, error: { code: 'P0001', message: 'plpgsql: saldo insuficiente' } }
      }
      if (nombre === 'cobros_de_comprobante') return { data: mocks.cobros, error: null }
      if (nombre === 'saldo_comprobante') return { data: [mocks.saldo], error: null }
      if (nombre === 'puede_registrar_cobro') return { data: true, error: null }
      return { data: null, error: null }
    })
    render(arbol('/ventas/comprobantes/k-1'))
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar cobro' }))
    const dialogo = await screen.findByRole('dialog')

    fireEvent.mouseDown(within(dialogo).getByRole('combobox', { name: 'Forma de pago' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Efectivo' }))
    fireEvent.change(within(dialogo).getByRole('textbox', { name: 'Importe' }), { target: { value: '400' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar cobro' }))

    expect(await within(dialogo).findByText('El importe supera el saldo pendiente de la factura.')).toBeInTheDocument()
    expect(within(dialogo).queryByText(/plpgsql/)).not.toBeInTheDocument()
  })
})

// Los estados del kit dentro del diálogo (F-VTA-12, FR-007 y SC-002): si el catálogo de la tienda
// no se puede leer, la pantalla lo dice y no manda un cobro a ciegas.
describe('Detalle del comprobante · estados del diálogo (F-VTA-12, SC-002)', () => {
  it('si no se pueden cargar las formas de pago, lo avisa y no registra el cobro', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // El error crudo puede traer el detalle de la fila (con datos de la cuenta): a la consola
    // va solo el código (cierre de la épica, T032).
    mocks.listarFormasPago.mockRejectedValue(
      Object.assign(new Error('falló el catálogo'), {
        code: '23514',
        details: 'Failing row contains (2850591612345678901233)',
      }),
    )
    render(arbol('/ventas/comprobantes/k-1'))
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar cobro' }))
    const dialogo = await screen.findByRole('dialog')

    expect(
      await within(dialogo).findByText('No pudimos cargar las formas de pago de la tienda. Reintentá.'),
    ).toBeInTheDocument()
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar cobro' }))

    expect(await within(dialogo).findByText('Elegí la forma de pago.')).toBeInTheDocument()
    expect(mocks.rpc.mock.calls.filter(([nombre]) => nombre === 'registrar_cobro')).toHaveLength(0)
    const llamadas = JSON.stringify(consola.mock.calls)
    expect(llamadas).toContain('23514')
    expect(llamadas).not.toContain('2850591612345678901233')
    consola.mockRestore()
  })

  it('si la tienda no tiene formas de pago, lo dice y no deja registrar', async () => {
    mocks.listarFormasPago.mockResolvedValue([])
    render(arbol('/ventas/comprobantes/k-1'))
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar cobro' }))
    const dialogo = await screen.findByRole('dialog')

    expect(
      await within(dialogo).findByText(/La tienda no tiene formas de pago cargadas/),
    ).toBeInTheDocument()
    expect(within(dialogo).getByRole('button', { name: 'Registrar cobro' })).toBeDisabled()
    expect(mocks.rpc.mock.calls.filter(([nombre]) => nombre === 'registrar_cobro')).toHaveLength(0)
  })

  it('si no se pueden cargar las cuentas de cobro, lo avisa en el campo', async () => {
    mocks.useListarCuentasCobro.mockReturnValue({
      cuentas: [],
      total: 0,
      isLoading: false,
      isFetching: false,
      isError: true,
      refetch: vi.fn(),
    })
    render(arbol('/ventas/comprobantes/k-1'))
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar cobro' }))
    const dialogo = await screen.findByRole('dialog')

    expect(
      await within(dialogo).findByText('No pudimos cargar las cuentas de cobro de la tienda.'),
    ).toBeInTheDocument()
  })

  it('al reabrir el diálogo no quedan los errores del intento anterior', async () => {
    render(arbol('/ventas/comprobantes/k-1'))
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar cobro' }))
    const dialogo = await screen.findByRole('dialog')

    fireEvent.change(within(dialogo).getByRole('textbox', { name: 'Importe' }), { target: { value: '' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar cobro' }))
    expect(await within(dialogo).findByText('Ingresá el importe del cobro.')).toBeInTheDocument()

    fireEvent.click(within(dialogo).getByRole('button', { name: 'Cerrar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Registrar cobro' }))
    const reopened = await screen.findByRole('dialog')
    expect(within(reopened).queryByText('Ingresá el importe del cobro.')).not.toBeInTheDocument()
    expect(within(reopened).getByRole('textbox', { name: 'Importe' })).toHaveValue('1000')
  })
})

// Un cobro es dinero: dos aprietes no pueden dejar dos cobros (FR-003 serializa en la base; acá
// se evita el doble envío mientras el primero está en vuelo).
describe('Detalle del comprobante · concurrencia (F-VTA-12, SC-002)', () => {
  const rpcConCobroEnVuelo = () => {
    let resolver: (valor: { data: unknown; error: null }) => void = () => undefined
    mocks.rpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'registrar_cobro') {
        return new Promise((resolve) => {
          resolver = resolve as (valor: { data: unknown; error: null }) => void
        })
      }
      if (nombre === 'cobros_de_comprobante') return { data: mocks.cobros, error: null }
      if (nombre === 'saldo_comprobante') return { data: [mocks.saldo], error: null }
      if (nombre === 'puede_registrar_cobro') return { data: true, error: null }
      return { data: null, error: null }
    })
    return () => resolver({ data: { id: 'b-9', importe: 400 }, error: null })
  }

  const cobrarEnElDialogo = async () => {
    render(arbol('/ventas/comprobantes/k-1'))
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar cobro' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.mouseDown(within(dialogo).getByRole('combobox', { name: 'Forma de pago' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Efectivo' }))
    fireEvent.change(within(dialogo).getByRole('textbox', { name: 'Importe' }), { target: { value: '400' } })
    return dialogo
  }

  it('no manda dos veces el cobro si se aprieta dos veces', async () => {
    const resolver = rpcConCobroEnVuelo()
    const dialogo = await cobrarEnElDialogo()

    const formulario = within(dialogo).getByRole('textbox', { name: 'Importe' }).closest('form')
    fireEvent.submit(formulario as HTMLFormElement)
    fireEvent.submit(formulario as HTMLFormElement)

    expect(llamadas('registrar_cobro')).toBe(1)
    resolver()
    expect(await screen.findByText('Cobro registrado · $ 400')).toBeInTheDocument()
  })

  it('mientras registra, el botón queda en «Registrando…» y deshabilitado', async () => {
    const resolver = rpcConCobroEnVuelo()
    const dialogo = await cobrarEnElDialogo()

    const formulario = within(dialogo).getByRole('textbox', { name: 'Importe' }).closest('form')
    fireEvent.submit(formulario as HTMLFormElement)

    const guardando = await within(dialogo).findByRole('button', { name: 'Registrando…' })
    expect(guardando).toBeDisabled()
    resolver()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('Detalle del comprobante · campo Cuenta de cobro (F-VTA-12, FR-008)', () => {
  it('muestra la cuenta del último cobro, si está conciliada y el enlace a Pagos', async () => {
    mocks.cobros = [COBRO]
    render(arbol('/ventas/comprobantes/k-1'))

    const campo = await screen.findByRole('group', { name: 'Cuenta de cobro' })
    expect(within(campo).getByText('Banco Uno · Comercial Ejemplo SRL')).toBeInTheDocument()
    expect(within(campo).getByText('Sin conciliar')).toBeInTheDocument()
    expect(within(campo).getByRole('link', { name: 'Ir a Pagos →' })).toHaveAttribute('href', '/ventas/pagos')
    expect(within(campo).getByText('Titular y CUIT se ven al elegir la cuenta. Se concilia en Pagos.')).toBeInTheDocument()
  })

  it('el chip dice «Conciliado» cuando el cobro está aprobado', async () => {
    mocks.cobros = [{ ...COBRO, conciliado: true, aprobado_por: 'mostrador-uno@example.com' }]
    render(arbol('/ventas/comprobantes/k-1'))

    const campo = await screen.findByRole('group', { name: 'Cuenta de cobro' })
    expect(within(campo).getByText('Conciliado')).toBeInTheDocument()
    expect(within(campo).queryByText('Sin conciliar')).not.toBeInTheDocument()
  })

  it('con un cobro sin cuenta el campo queda vacío', async () => {
    mocks.cobros = [{ ...COBRO, cuenta_cobro: null, cuenta_cobro_banco: null, cuenta_cobro_titular: null, forma_pago: 'Efectivo', forma_pago_tipo: 'efectivo' }]
    render(arbol('/ventas/comprobantes/k-1'))

    const campo = await screen.findByRole('group', { name: 'Cuenta de cobro' })
    expect(within(campo).queryByText('Sin conciliar')).not.toBeInTheDocument()
    expect(within(campo).getByText('—')).toBeInTheDocument()
  })

  it('con contrarreembolso explica que lo cobra el transporte', async () => {
    mocks.cobros = [{ ...COBRO, forma_pago: 'Contrarreembolso', forma_pago_tipo: 'contrarreembolso' }]
    render(arbol('/ventas/comprobantes/k-1'))

    expect(
      await screen.findByText('El transporte cobra al entregar. Queda en Transportes y contrarreembolsos hasta que lo rindan.'),
    ).toBeInTheDocument()
  })
})

describe('Detalle del comprobante · cambio de empresa activa (F-VTA-12, FR-009)', () => {
  it('al cambiar de tienda recarga los cobros y el saldo', async () => {
    const vista = render(arbol('/ventas/comprobantes/k-1'))
    await screen.findByRole('heading', { name: 'Cobros' })
    const antes = llamadas('cobros_de_comprobante')

    mocks.useEmpresasAccesibles.mockReturnValue(accesibles(null))
    vista.rerender(arbol('/ventas/comprobantes/k-1'))

    await waitFor(() => expect(llamadas('cobros_de_comprobante')).toBe(antes + 1))
    expect(llamadas('saldo_comprobante')).toBeGreaterThan(1)
  })

  it('una respuesta vieja no pisa los cobros ni el saldo de la tienda nueva', async () => {
    const cobrosViejos = diferido<{ data: unknown; error: null }>()
    const cobrosNuevos = diferido<{ data: unknown; error: null }>()
    const saldoViejo = diferido<{ data: unknown; error: null }>()
    const saldoNuevo = diferido<{ data: unknown; error: null }>()
    let ronda = 0
    mocks.rpc.mockImplementation((nombre: string) => {
      if (nombre === 'cobros_de_comprobante') {
        ronda += 1
        return ronda === 1 ? cobrosViejos.promesa : cobrosNuevos.promesa
      }
      if (nombre === 'saldo_comprobante') return ronda === 1 ? saldoViejo.promesa : saldoNuevo.promesa
      if (nombre === 'puede_registrar_cobro') return Promise.resolve({ data: true, error: null })
      return Promise.resolve({ data: null, error: null })
    })

    const vista = render(arbol('/ventas/comprobantes/k-1'))
    await screen.findByRole('heading', { name: 'Cobros' })
    await waitFor(() => expect(llamadas('cobros_de_comprobante')).toBe(1))

    mocks.useEmpresasAccesibles.mockReturnValue(accesibles(null))
    vista.rerender(arbol('/ventas/comprobantes/k-1'))
    await waitFor(() => expect(llamadas('cobros_de_comprobante')).toBe(2))

    await act(async () => {
      cobrosNuevos.resolver({ data: [{ ...COBRO, forma_pago: 'Transferencia nueva' }], error: null })
      saldoNuevo.resolver({ data: [{ total: 1000, cobrado: 600, saldo: 400 }], error: null })
    })
    expect(await screen.findByText('Transferencia nueva')).toBeInTheDocument()

    // La primera consulta (la de la tienda anterior) llega tarde: no puede pintar su fila ni
    // su saldo sobre lo que ya se cargó para la tienda nueva.
    await act(async () => {
      cobrosViejos.resolver({ data: [{ ...COBRO, forma_pago: 'Transferencia vieja' }], error: null })
      saldoViejo.resolver({ data: [{ total: 1000, cobrado: 900, saldo: 100 }], error: null })
    })

    expect(screen.queryByText('Transferencia vieja')).not.toBeInTheDocument()
    expect(screen.queryByText('$ 900')).not.toBeInTheDocument()
    expect(screen.getByText('Transferencia nueva')).toBeInTheDocument()
    expect(screen.getByText('$ 600')).toBeInTheDocument()
  })

  it('cierra con aviso el diálogo de cobro abierto al cambiar de tienda', async () => {
    const vista = render(arbol('/ventas/comprobantes/k-1'))
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar cobro' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()

    mocks.useEmpresasAccesibles.mockReturnValue(accesibles(null))
    vista.rerender(arbol('/ventas/comprobantes/k-1'))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(
      await screen.findByText('Cambiaste de tienda: cerramos el diálogo de cobro y recargamos los cobros de la factura.'),
    ).toBeInTheDocument()
  })

  it('después del aviso por cambio de tienda se puede volver a registrar un cobro', async () => {
    const vista = render(arbol('/ventas/comprobantes/k-1'))
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar cobro' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()

    mocks.useEmpresasAccesibles.mockReturnValue(accesibles(null))
    vista.rerender(arbol('/ventas/comprobantes/k-1'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(
      await screen.findByText('Cambiaste de tienda: cerramos el diálogo de cobro y recargamos los cobros de la factura.'),
    ).toBeInTheDocument()

    // El aviso no deja la pantalla a medias: el diálogo se vuelve a abrir y el cobro se registra.
    fireEvent.click(screen.getByRole('button', { name: 'Registrar cobro' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.mouseDown(within(dialogo).getByRole('combobox', { name: 'Forma de pago' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Transferencia' }))
    fireEvent.mouseDown(within(dialogo).getByRole('combobox', { name: 'Cuenta de cobro' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Banco Uno · Comercial Ejemplo SRL' }))
    fireEvent.change(within(dialogo).getByRole('textbox', { name: 'Importe' }), { target: { value: '400' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar cobro' }))

    expect(await screen.findByText('Cobro registrado · $ 400')).toBeInTheDocument()
    await waitFor(() => expect(llamadas('cobros_de_comprobante')).toBeGreaterThan(1))
  })
})

// ============================================================================
// SC-002 (F-VTA-12): solo lectura por rol, teclado y lector de pantalla.
// ============================================================================

describe('Detalle del comprobante · solo lectura por rol (F-VTA-12, SC-002)', () => {
  it('un rol sin la acción lee los cobros pero no puede registrar', async () => {
    mocks.puedeRegistrar = false
    mocks.cobros = [COBRO]
    mocks.saldo = { total: 1000, cobrado: 400, saldo: 600 }
    render(arbol('/ventas/comprobantes/k-1'))

    // Lee: la lista y los totales están.
    const tabla = await screen.findByRole('table', { name: 'Cobros del comprobante' })
    expect(within(tabla).getByText('Transferencia')).toBeInTheDocument()
    const totales = screen.getByRole('group', { name: 'Totales de los cobros' })
    expect(within(totales).getByText('$ 400')).toBeInTheDocument()
    expect(within(totales).getByText('$ 600')).toBeInTheDocument()

    // No puede modificar: sin botón, sin diálogo y sin pedir el registro a la base.
    expect(screen.queryByRole('button', { name: 'Registrar cobro' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.rpc.mock.calls.filter(([nombre]) => nombre === 'registrar_cobro')).toHaveLength(0)
  })

  it('un rol sin la acción igual lee la cuenta de cobro, el chip y el enlace a Pagos', async () => {
    mocks.puedeRegistrar = false
    mocks.cobros = [COBRO]
    render(arbol('/ventas/comprobantes/k-1'))

    const campo = await screen.findByRole('group', { name: 'Cuenta de cobro' })
    expect(within(campo).getByText('Banco Uno · Comercial Ejemplo SRL')).toBeInTheDocument()
    expect(within(campo).getByText('Sin conciliar')).toBeInTheDocument()
    expect(within(campo).getByRole('link', { name: 'Ir a Pagos →' })).toHaveAttribute('href', '/ventas/pagos')
  })

  it('con la factura cobrada el botón «Registrar cobro» no se ofrece aunque haya permiso', async () => {
    mocks.saldo = { total: 1000, cobrado: 1000, saldo: 0 }
    render(arbol('/ventas/comprobantes/k-1'))

    expect(await screen.findByText('No queda saldo pendiente: la factura está cobrada.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Registrar cobro' })).toBeDisabled()
  })
})

describe('Detalle del comprobante · teclado (F-VTA-12, SC-002)', () => {
  it('el botón «Registrar cobro» es un botón nativo que toma el foco', async () => {
    render(arbol('/ventas/comprobantes/k-1'))
    const boton = await screen.findByRole('button', { name: 'Registrar cobro' })

    expect(boton.tagName).toBe('BUTTON')
    expect(boton).not.toHaveAttribute('tabindex', '-1')
    boton.focus()
    expect(document.activeElement).toBe(boton)
  })

  it('al abrir el diálogo el foco queda dentro y con Escape se cierra', async () => {
    render(arbol('/ventas/comprobantes/k-1'))
    const boton = await screen.findByRole('button', { name: 'Registrar cobro' })
    boton.focus()
    fireEvent.click(boton)

    const dialogo = await screen.findByRole('dialog', { name: 'Registrar cobro' })
    // MUI lleva el foco al papel del diálogo (dentro de la capa de transición).
    expect(dialogo.closest('[role="presentation"]')).toContainElement(document.activeElement as HTMLElement)

    fireEvent.keyDown(dialogo, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('al cerrar el diálogo el foco vuelve al botón que lo abrió', async () => {
    render(arbol('/ventas/comprobantes/k-1'))
    const boton = await screen.findByRole('button', { name: 'Registrar cobro' })
    boton.focus()
    fireEvent.click(boton)

    const dialogo = await screen.findByRole('dialog', { name: 'Registrar cobro' })
    fireEvent.keyDown(dialogo, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    // El foco no se pierde: vuelve al botón que abrió el diálogo.
    await waitFor(() => expect(document.activeElement).toBe(boton))
  })

  it('el botón «Cerrar» del diálogo cierra sin registrar', async () => {
    render(arbol('/ventas/comprobantes/k-1'))
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar cobro' }))

    const dialogo = await screen.findByRole('dialog', { name: 'Registrar cobro' })
    const cerrar = within(dialogo).getByRole('button', { name: 'Cerrar' })
    expect(cerrar.tagName).toBe('BUTTON')
    fireEvent.click(cerrar)

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.rpc.mock.calls.filter(([nombre]) => nombre === 'registrar_cobro')).toHaveLength(0)
  })

  it('con la validación en el medio, el foco va al campo que falta', async () => {
    render(arbol('/ventas/comprobantes/k-1'))
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar cobro' }))
    const dialogo = await screen.findByRole('dialog')

    fireEvent.change(within(dialogo).getByRole('textbox', { name: 'Importe' }), { target: { value: '' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar cobro' }))

    await within(dialogo).findByText('Ingresá el importe del cobro.')
    expect(document.activeElement).toBe(within(dialogo).getByRole('textbox', { name: 'Importe' }))
  })

  it('el envío del diálogo es un formulario con botón de enviar (Enter lo manda)', async () => {
    render(arbol('/ventas/comprobantes/k-1'))
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar cobro' }))
    const dialogo = await screen.findByRole('dialog')

    // El envío es un <form> con botón de tipo «submit»: en el navegador, Enter en un campo
    // lo manda. jsdom no arma ese envío implícito, así que se dispara el «submit» del form.
    const formulario = within(dialogo).getByRole('textbox', { name: 'Importe' }).closest('form')
    expect(formulario).not.toBeNull()
    expect(within(dialogo).getByRole('button', { name: 'Registrar cobro' })).toHaveAttribute('type', 'submit')

    fireEvent.submit(formulario as HTMLFormElement)
    expect(await within(dialogo).findByText('Elegí la forma de pago.')).toBeInTheDocument()
  })
})

describe('Detalle del comprobante · lector de pantalla (F-VTA-12, SC-002)', () => {
  it('la lista es una tabla con encabezados y los totales son un grupo con nombre', async () => {
    mocks.cobros = [COBRO]
    render(arbol('/ventas/comprobantes/k-1'))

    const tabla = await screen.findByRole('table', { name: 'Cobros del comprobante' })
    expect(within(tabla).getAllByRole('columnheader').map((columna) => columna.textContent)).toEqual([
      'Fecha',
      'Forma de pago',
      'Cuenta de cobro',
      'Importe',
      'Registró',
    ])
    expect(within(tabla).getAllByRole('row')).toHaveLength(2)

    expect(screen.getByRole('group', { name: 'Totales de los cobros' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Cobros' })).toBeInTheDocument()
  })

  it('el campo «Cuenta de cobro» tiene nombre accesible y el chip se lee como texto', async () => {
    mocks.cobros = [COBRO]
    render(arbol('/ventas/comprobantes/k-1'))

    const campo = await screen.findByRole('group', { name: 'Cuenta de cobro' })
    // El estado se dice con palabras, no solo con color.
    expect(within(campo).getByText('Sin conciliar')).toBeInTheDocument()
  })

  it('los errores quedan asociados al campo: el lector los anuncia con el campo', async () => {
    render(arbol('/ventas/comprobantes/k-1'))
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar cobro' }))
    const dialogo = await screen.findByRole('dialog')

    fireEvent.change(within(dialogo).getByRole('textbox', { name: 'Importe' }), { target: { value: '' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar cobro' }))

    const importe = within(dialogo).getByRole('textbox', { name: 'Importe' })
    await within(dialogo).findByText('Ingresá el importe del cobro.')
    expect(importe).toHaveAttribute('aria-invalid', 'true')
    expect(importe).toHaveAccessibleDescription('Ingresá el importe del cobro.')

    const forma = within(dialogo).getByRole('combobox', { name: 'Forma de pago' })
    expect(forma).toHaveAttribute('aria-invalid', 'true')
    expect(forma).toHaveAccessibleDescription('Elegí la forma de pago.')
  })

  it('el diálogo se anuncia con su nombre y sus campos con su etiqueta', async () => {
    render(arbol('/ventas/comprobantes/k-1'))
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar cobro' }))

    const dialogo = await screen.findByRole('dialog', { name: 'Registrar cobro' })
    expect(within(dialogo).getByRole('combobox', { name: 'Forma de pago' })).toBeInTheDocument()
    expect(within(dialogo).getByRole('combobox', { name: 'Cuenta de cobro' })).toBeInTheDocument()
    expect(within(dialogo).getByRole('textbox', { name: 'Importe' })).toBeInTheDocument()
  })

  it('la tarjeta de cobros no tiene violaciones de axe', async () => {
    mocks.cobros = [COBRO]
    const { container } = render(arbol('/ventas/comprobantes/k-1'))

    await screen.findByRole('table', { name: 'Cobros del comprobante' })
    expect(await violacionesAxe(container)).toEqual([])
  })

  it('el diálogo de cobro no tiene violaciones de axe', async () => {
    render(arbol('/ventas/comprobantes/k-1'))
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar cobro' }))

    const dialogo = await screen.findByRole('dialog', { name: 'Registrar cobro' })
    expect(await violacionesAxe(dialogo)).toEqual([])
  })
})
