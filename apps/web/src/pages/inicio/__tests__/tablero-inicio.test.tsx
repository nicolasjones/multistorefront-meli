import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../test/axe'

const mocks = vi.hoisted(() => ({ leer: vi.fn(), depositos: vi.fn(), cambiarEmpresa: vi.fn(), empresa: { valor: null as string | null } }))

vi.mock('../../../lib/inicioTablero', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../lib/inicioTablero')>()), leerResumenInicio: mocks.leer }))
vi.mock('../../../lib/depositos', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../lib/depositos')>()), listarDepositosActivos: mocks.depositos }))
vi.mock('../../../lib/inicioBloques', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/inicioBloques')>()),
  leerBloquesInicio: vi.fn().mockResolvedValue({ por_tienda: [], salidas_por_deposito: [] }),
  leerActividadReciente: vi.fn().mockResolvedValue([]),
  leerMovimientosPorProducto: vi.fn().mockResolvedValue({ filas: [], total: 0 }),
}))
vi.mock('../../../lib/categorias', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/categorias')>()),
  leerCategorias: vi.fn().mockResolvedValue({ categorias: [], conteos: new Map() }),
}))
vi.mock('../../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: { id: 'org-1' } }) }))
vi.mock('../../../hooks/useFiltroPorEmpresaActiva', () => ({
  useFiltroPorEmpresaActiva: () => ({
    empresas: [{ id: 'e1000000-0000-4000-8000-000000000001', nombre: 'San Javucho' }, { id: 'e1000000-0000-4000-8000-000000000002', nombre: 'Mundo JC' }],
    valor: mocks.empresa.valor,
    cambiar: mocks.cambiarEmpresa,
    empresaActivaId: null,
    cargando: false,
    hayError: false,
  }),
}))

import { TableroInicio } from '../tablero/TableroInicio'

// El gráfico se baja con `import()` diferido: en jsdom la primera carga de x-charts tarda más que el segundo por defecto.
const ESPERA_GRAFICO = { timeout: 15_000 }

const DEPOSITO = 'd1000000-0000-4000-8000-000000000001'

const RESUMEN = {
  desde: '2026-10-01', hasta: '2026-10-15', anterior_desde: '2026-09-16', anterior_hasta: '2026-09-30',
  ventas: {
    monto: 4235, comprobantes: 2, unidades: 4, devoluciones_monto: 605, devoluciones_unidades: 1,
    anterior_monto: 2117.5, anterior_comprobantes: 4, ticket_promedio: 2117.5,
  },
  stock: { unidades: 120, reservado: 20, disponible: 100, sin_stock: 3, stock_bajo: 1, ajustes: 2, entradas_unidades: 15 },
  serie: [
    { dia: '2026-10-01', unidades: 0, stock: 110 },
    { dia: '2026-10-02', unidades: 4, stock: 106 },
    { dia: '2026-10-03', unidades: 2, stock: 120 },
  ],
}

function Ubicacion() {
  const { pathname, search } = useLocation()
  return <output data-testid="url">{pathname}{search}</output>
}

const abrir = (entrada = '/', props: { verVentas?: boolean; verStock?: boolean; verReportes?: boolean } = {}) =>
  render(
    <MemoryRouter initialEntries={[entrada]}>
      <TableroInicio verVentas={props.verVentas ?? true} verStock={props.verStock ?? true} verReportes={props.verReportes ?? true} />
      <Ubicacion />
    </MemoryRouter>,
  )

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T15:00:00Z'))
  mocks.leer.mockReset()
  mocks.leer.mockResolvedValue(RESUMEN)
  mocks.depositos.mockReset()
  mocks.depositos.mockResolvedValue([{ id: DEPOSITO, nombre: 'Central', por_defecto: true }])
  mocks.cambiarEmpresa.mockReset()
  mocks.empresa.valor = null
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Tablero de Inicio · filtros (FR-001)', () => {
  it('abre con el mes en curso, todas las tiendas y todos los depósitos', async () => {
    abrir()
    expect(await screen.findByText('Ventas del período')).toBeInTheDocument()
    expect(mocks.leer).toHaveBeenCalledWith({ desde: '2026-10-01', hasta: '2026-10-15', empresaId: null, depositoId: null })
    expect(screen.getByRole('button', { name: 'Este mes' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Todas las tiendas' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('cambiar el período lo refleja en la URL y vuelve a consultar', async () => {
    abrir()
    await screen.findByText('Ventas del período')
    fireEvent.click(screen.getByRole('button', { name: 'Hoy' }))
    await waitFor(() => expect(mocks.leer).toHaveBeenLastCalledWith({ desde: '2026-10-15', hasta: '2026-10-15', empresaId: null, depositoId: null }))
    expect(screen.getByTestId('url')).toHaveTextContent('/?periodo=hoy')
  })

  it('rango libre: consulta con las fechas elegidas y avisa un rango inválido sin consultarlo', async () => {
    abrir('/?periodo=rango&desde=2026-09-01&hasta=2026-09-30')
    await screen.findByText('Ventas del período')
    expect(mocks.leer).toHaveBeenLastCalledWith({ desde: '2026-09-01', hasta: '2026-09-30', empresaId: null, depositoId: null })
    const llamadas = mocks.leer.mock.calls.length
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-20' } })
    expect(await screen.findByText('Hasta no puede ser anterior a Desde.')).toBeInTheDocument()
    expect(mocks.leer).toHaveBeenCalledTimes(llamadas)
  })

  it('el depósito elegido llega a la consulta y a la URL', async () => {
    abrir()
    await screen.findByText('Ventas del período')
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Depósito' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Central' }))
    await waitFor(() => expect(mocks.leer).toHaveBeenLastCalledWith({ desde: '2026-10-01', hasta: '2026-10-15', empresaId: null, depositoId: DEPOSITO }))
    expect(screen.getByTestId('url')).toHaveTextContent(`deposito=${DEPOSITO}`)
  })

  it('la tienda sale de las empresas de la organización (sin nombres fijos) y sigue a la empresa activa', async () => {
    mocks.empresa.valor = 'e1000000-0000-4000-8000-000000000002'
    abrir()
    await screen.findByText('Ventas del período')
    expect(mocks.leer).toHaveBeenCalledWith(expect.objectContaining({ empresaId: 'e1000000-0000-4000-8000-000000000002' }))
    expect(screen.getByRole('button', { name: 'Mundo JC' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('elegir una tienda la refleja en la URL y consulta con ella (CA-INI-04-7)', async () => {
    abrir()
    await screen.findByText('Ventas del período')
    fireEvent.click(screen.getByRole('button', { name: 'San Javucho' }))
    await waitFor(() => expect(mocks.leer).toHaveBeenLastCalledWith(expect.objectContaining({ empresaId: 'e1000000-0000-4000-8000-000000000001' })))
    expect(screen.getByTestId('url')).toHaveTextContent('tienda=e1000000-0000-4000-8000-000000000001')
  })

  it('una URL compartida con tienda y depósito reproduce la misma vista en otra sesión', async () => {
    mocks.empresa.valor = 'e1000000-0000-4000-8000-000000000001' // la empresa activa de la otra sesión es otra
    abrir('/?periodo=hoy&tienda=e1000000-0000-4000-8000-000000000002&deposito=' + DEPOSITO)
    await screen.findByText('Ventas del período')
    expect(mocks.leer).toHaveBeenLastCalledWith({ desde: '2026-10-15', hasta: '2026-10-15', empresaId: 'e1000000-0000-4000-8000-000000000002', depositoId: DEPOSITO })
    expect(screen.getByRole('button', { name: 'Mundo JC' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('«todas» en la URL gana sobre la empresa activa, y una tienda que no es accesible se ignora', async () => {
    mocks.empresa.valor = 'e1000000-0000-4000-8000-000000000001'
    abrir('/?tienda=todas')
    await screen.findByText('Ventas del período')
    expect(mocks.leer).toHaveBeenLastCalledWith(expect.objectContaining({ empresaId: null }))
  })

  it('una tienda de la URL que no es accesible vuelve a la empresa activa', async () => {
    mocks.empresa.valor = 'e1000000-0000-4000-8000-000000000001'
    abrir('/?tienda=e9999999-0000-4000-8000-000000000009')
    await screen.findByText('Ventas del período')
    expect(mocks.leer).toHaveBeenLastCalledWith(expect.objectContaining({ empresaId: 'e1000000-0000-4000-8000-000000000001' }))
  })

  it('un depósito de la URL que no existe cae a «Todos los depósitos» y consulta sin él', async () => {
    abrir('/?deposito=d9999999-0000-4000-8000-000000000009')
    await screen.findByText('Ventas del período')
    expect(mocks.leer).toHaveBeenLastCalledWith(expect.objectContaining({ depositoId: null }))
    expect(mocks.leer).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('combobox', { name: 'Depósito' })).toHaveTextContent('Todos los depósitos')
  })
})

describe('Tablero de Inicio · indicadores (FR-002, FR-003, FR-005)', () => {
  it('«Ventas del período»: monto con IVA, comprobantes, ticket, variación, unidades y devoluciones', async () => {
    abrir()
    const bloque = (await screen.findByText('Ventas del período')).closest('div.MuiCardContent-root') as HTMLElement
    const ventas = within(bloque)
    expect(ventas.getByRole('link', { name: /Ventas \(con IVA\): \$\s?4\.235, \+100 % vs período anterior/ })).toBeInTheDocument()
    expect(ventas.getByRole('link', { name: /Comprobantes: 2, -50 % vs período anterior/ })).toBeInTheDocument()
    expect(ventas.getByRole('link', { name: /Ticket promedio \(con IVA\): \$\s?2\.118/ })).toBeInTheDocument()
    expect(ventas.getByRole('link', { name: /Unidades vendidas: 4, Netas de devoluciones/ })).toBeInTheDocument()
    expect(ventas.getByRole('link', { name: /Devoluciones \(con IVA\): \$\s?605, 1 unidades devueltas/ })).toBeInTheDocument()
  })

  it('el ticket promedio también se compara con el del período anterior', async () => {
    // Actual: 4235 / 2 = 2117,5. Anterior: 2117,5 / 4 = 529,38 → +300 %.
    abrir()
    await screen.findByText('Ventas del período')
    expect(screen.getByRole('link', { name: /Ticket promedio \(con IVA\): \$\s?2\.118, \+300 % vs período anterior/ })).toBeInTheDocument()
  })

  it('sin la sección reportes los indicadores de ventas no enlazan (Reportes les negaría el acceso)', async () => {
    abrir('/', { verReportes: false })
    await screen.findByText('Ventas del período')
    expect(screen.queryByRole('link', { name: /Ventas \(con IVA\)/ })).not.toBeInTheDocument()
    expect(screen.getByText('Ventas (con IVA)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Sin stock: 3/ })).toBeInTheDocument()
  })

  it('sin período anterior no inventa una variación', async () => {
    mocks.leer.mockResolvedValue({ ...RESUMEN, ventas: { ...RESUMEN.ventas, anterior_monto: 0, anterior_comprobantes: 0 } })
    abrir()
    expect((await screen.findAllByText('Sin período anterior para comparar')).length).toBe(3)
  })

  it('«Stock hoy»: unidades, reservado, disponible, sin stock, stock bajo y ajustes', async () => {
    abrir()
    await screen.findByText('Stock hoy')
    expect(screen.getByRole('link', { name: /Stock actual: 120 u\./ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Reservado: 20 u\./ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Disponible para vender: 100 u\./ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Sin stock: 3, productos/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Stock bajo: 1, producto\./ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ajustes de stock: 2, Entradas en el período: \+15 u\./ })).toBeInTheDocument()
  })

  it('cada indicador enlaza al listado ya filtrado', async () => {
    abrir('/?deposito=' + DEPOSITO)
    await screen.findByText('Stock hoy')
    expect(screen.getByRole('link', { name: /Ventas \(con IVA\)/ })).toHaveAttribute('href', '/ventas/reportes?desde=2026-10-01&hasta=2026-10-15')
    expect(screen.getByRole('link', { name: /Sin stock: 3/ })).toHaveAttribute('href', `/stock?filtro=sin_stock&deposito=${DEPOSITO}`)
    expect(screen.getByRole('link', { name: /Stock bajo: 1/ })).toHaveAttribute('href', `/stock?filtro=stock_bajo&deposito=${DEPOSITO}`)
    expect(screen.getByRole('link', { name: /Ajustes de stock/ })).toHaveAttribute('href', '/stock/movimientos')
  })

  it('un período sin ventas lo dice', async () => {
    mocks.leer.mockResolvedValue({ ...RESUMEN, ventas: { ...RESUMEN.ventas, monto: 0, comprobantes: 0, unidades: 0, devoluciones_monto: 0, devoluciones_unidades: 0, ticket_promedio: null } })
    abrir()
    expect(await screen.findByText('No hay ventas en este período.')).toBeInTheDocument()
  })
})

describe('Tablero de Inicio · gráfico (FR-004)', { timeout: 30_000 }, () => {
  // La primera carga en frío de x-charts es lenta: se precarga una vez para que el `import()` diferido del tablero ya la tenga.
  beforeAll(async () => { await import('../tablero/GraficoVentasStock') }, 120_000)

  it('muestra «Ventas y stock en el tiempo» con su descripción y la tabla equivalente', async () => {
    const { container } = abrir()
    await screen.findByText('Stock hoy')
    expect(screen.getByRole('heading', { name: 'Ventas y stock en el tiempo' })).toBeInTheDocument()
    await waitFor(() => expect(container.querySelector('svg title')?.textContent).toBe('Ventas y stock en el tiempo'), ESPERA_GRAFICO)
    await waitFor(() => expect(container.querySelector('svg desc')).not.toBeNull(), ESPERA_GRAFICO)
    expect(container.querySelector('svg desc')?.textContent).toContain('unidades vendidas por día y stock al cierre de cada día')
    const tabla = await screen.findByRole('table', { hidden: true }, ESPERA_GRAFICO)
    expect(within(tabla).getAllByRole('row', { hidden: true })).toHaveLength(4)
    expect(within(tabla).getByRole('columnheader', { name: 'Stock al cierre', hidden: true })).toBeInTheDocument()
  })

  it('sin datos en el período, estado vacío', async () => {
    mocks.leer.mockResolvedValue({ ...RESUMEN, serie: [] })
    abrir()
    expect(await screen.findByText('Sin datos en el período', undefined, ESPERA_GRAFICO)).toBeInTheDocument()
  })

  it('sin ventas en ningún día el gráfico queda vacío aunque haya stock (CA-INI-04-4)', async () => {
    mocks.leer.mockResolvedValue({ ...RESUMEN, serie: RESUMEN.serie.map((p) => ({ ...p, unidades: 0 })) })
    abrir()
    expect(await screen.findByText('Sin datos en el período', undefined, ESPERA_GRAFICO)).toBeInTheDocument()
  })

  it('un rol que solo ve stock ve la línea de stock aunque no tenga ventas', async () => {
    mocks.leer.mockResolvedValue({ ...RESUMEN, ventas: null, serie: RESUMEN.serie.map((p) => ({ ...p, unidades: null })) })
    const { container } = abrir('/', { verVentas: false })
    await screen.findByText('Stock hoy')
    await waitFor(() => expect(container.querySelector('svg title')).not.toBeNull(), ESPERA_GRAFICO)
    expect(screen.queryByText('Sin datos en el período')).not.toBeInTheDocument()
  })
})

describe('Tablero de Inicio · permisos (FR-006)', () => {
  it('ventas null: no hay bloque de ventas ni su serie, y no se expone costo ni margen', async () => {
    mocks.leer.mockResolvedValue({ ...RESUMEN, ventas: null, serie: RESUMEN.serie.map((p) => ({ ...p, unidades: null })) })
    const { container } = abrir('/', { verVentas: false })
    await screen.findByText('Stock hoy')
    expect(screen.queryByText('Ventas del período')).not.toBeInTheDocument()
    expect(screen.queryByText(/Unidades vendidas/)).not.toBeInTheDocument()
    expect(container).not.toHaveTextContent(/costo|margen/i)
  })

  it('stock null: no hay «Stock hoy» ni línea de stock', async () => {
    mocks.leer.mockResolvedValue({ ...RESUMEN, stock: null, serie: RESUMEN.serie.map((p) => ({ ...p, stock: null })) })
    abrir('/', { verStock: false })
    await screen.findByText('Ventas del período')
    expect(screen.queryByText('Stock hoy')).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Stock al cierre', hidden: true })).not.toBeInTheDocument()
  })

  it('sin ventas ni stock en la respuesta: aviso claro', async () => {
    mocks.leer.mockResolvedValue({ ...RESUMEN, ventas: null, stock: null, serie: [] })
    abrir()
    expect(await screen.findByText('No hay datos para mostrar')).toBeInTheDocument()
    expect(screen.getByText(/No tenés ventas ni stock habilitados para esta tienda/)).toBeInTheDocument()
  })

  it('sin permiso de stock ni ventas no se consultan los depósitos', async () => {
    abrir('/', { verVentas: false, verStock: false })
    await waitFor(() => expect(mocks.leer).toHaveBeenCalled())
    expect(mocks.depositos).not.toHaveBeenCalled()
  })
})

describe('Tablero de Inicio · estados', () => {
  it('error con reintento', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.leer.mockRejectedValueOnce(new Error('boom'))
    abrir()
    expect(await screen.findByText('No pudimos cargar este dato')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Ventas del período')).toBeInTheDocument()
  })

  it('un error no persiste al cambiar los filtros: se vuelve a cargar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.leer.mockRejectedValueOnce(new Error('boom'))
    abrir()
    expect(await screen.findByText('No pudimos cargar este dato')).toBeInTheDocument()
    mocks.leer.mockReturnValue(new Promise(() => undefined))
    fireEvent.click(screen.getByRole('button', { name: 'Hoy' }))
    await waitFor(() => expect(screen.queryByText('No pudimos cargar este dato')).not.toBeInTheDocument())
    expect(screen.getByRole('status', { name: 'Cargando el tablero' })).toBeInTheDocument()
  })

  it('mientras llegan los datos de otros filtros no se muestran los anteriores', async () => {
    abrir()
    await screen.findByText('Ventas del período')
    mocks.leer.mockReturnValue(new Promise(() => undefined))
    fireEvent.click(screen.getByRole('button', { name: 'Hoy' }))
    await waitFor(() => expect(screen.queryByText('Ventas del período')).not.toBeInTheDocument())
    expect(screen.getByRole('status', { name: 'Cargando el tablero' })).toBeInTheDocument()
  })
})

describe('Tablero de Inicio · accesibilidad', () => {
  it.each([320, 768, 1440])('sin violaciones de axe a %i px', async (ancho) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: ancho })
    const { container } = abrir()
    await screen.findByText('Stock hoy')
    expect(await violacionesAxe(container)).toEqual([])
  })
})
