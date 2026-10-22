import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

const mocks = vi.hoisted(() => ({
  useHistorialVentasCobros: vi.fn(),
  useEmpresasAccesibles: vi.fn(),
  useOrganizacionActiva: vi.fn(),
  refetch: vi.fn(),
  setTexto: vi.fn(),
  setPagina: vi.fn(),
}))

vi.mock('../../hooks/useHistorialVentasCobros', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/useHistorialVentasCobros')>()),
  useHistorialVentasCobros: mocks.useHistorialVentasCobros,
}))
vi.mock('../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: mocks.useEmpresasAccesibles }))
vi.mock('../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: mocks.useOrganizacionActiva }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import type { CobroHistorico, VentaHistorica } from '../../hooks/useHistorialVentasCobros'
import { HistorialList } from './list'

const venta = (n: number, extra: Partial<VentaHistorica> = {}): VentaHistorica => ({
  id: `v-${n}`, empresa_id: 'e-1', empresa_nombre: 'San Javucho', tipo: 'Factura', numero: `A-000${n}`, fecha: '2020-03-10',
  cliente_nombre: `Cliente ${n}`, cliente_numero: null, operador: 'Javier', estado_final: 'Cobrado', total: 412300, ...extra,
})
const cobro = (n: number): CobroHistorico => ({
  id: `c-${n}`, empresa_id: 'e-2', empresa_nombre: 'Mundo JC', fecha: '2020-03-11', comprobante_numero: `B-000${n}`,
  cliente_nombre: `Cliente ${n}`, cliente_numero: null, cuenta_cobro: 'Caja del local', aprobado_por: 'Ana', importe: 64200.5,
})

const respuesta = (filas: unknown[], extra: Record<string, unknown> = {}) => ({
  filas, total: filas.length, desde: '2020-01-10', hasta: '2020-03-11', texto: '', textoAplicado: '', pagina: 1,
  setTexto: mocks.setTexto, setPagina: mocks.setPagina, isLoading: false, isFetching: false, isError: false, refetch: mocks.refetch, ...extra,
})

const empresasAccesibles = (activa: string | null) => ({
  empresas: [{ id: 'e-1', nombre: 'San Javucho', esActiva: activa === 'e-1', rolId: null }, { id: 'e-2', nombre: 'Mundo JC', esActiva: activa === 'e-2', rolId: null }],
  empresaActivaId: activa, isLoading: false, isError: false,
})
const abrir = () => render(<MemoryRouter><HistorialList /></MemoryRouter>)
const ultimaLlamada = () => mocks.useHistorialVentasCobros.mock.calls.at(-1)!

function mockAnchoPantalla(angosta: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: angosta, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

describe('HistorialList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAnchoPantalla(false)
    mocks.useEmpresasAccesibles.mockReturnValue(empresasAccesibles(null))
    mocks.useOrganizacionActiva.mockReturnValue({ organizacionActiva: { id: 'o-1', nombre: 'Org 1' }, isLoading: false })
    mocks.useHistorialVentasCobros.mockImplementation((tipo: string) => respuesta(tipo === 'ventas' ? [venta(1), venta(2, { estado_final: 'Deuda' })] : [cobro(1)]))
  })
  afterEach(() => vi.restoreAllMocks())

  it('muestra encabezado, «Solo lectura», textos informativos y las tres pestañas', () => {
    abrir()
    expect(screen.getByRole('heading', { name: 'Historial', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('Solo lectura')).toBeInTheDocument()
    expect(screen.getByText('Consulta de lo registrado antes de la plataforma. No se puede editar ni borrar.')).toBeInTheDocument()
    expect(screen.getByText(/Datos del sistema anterior, importados una sola vez al migrar/)).toBeInTheDocument()
    expect(screen.getByText('Cada venta y cobro quedó asignado a la tienda que lo emitió. Las cotizaciones del dólar son globales.')).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Ventas', 'Cobros', 'Cotizaciones del dólar'])
    expect(screen.getByRole('tab', { name: 'Ventas' })).toHaveAttribute('aria-selected', 'true')
  })

  it('Ventas: columnas del prototipo, rótulo «Histórico», importes a la derecha y sin acciones', () => {
    abrir()
    for (const nombre of ['Comprobante', 'Tienda', 'Fecha', 'Cliente', 'Operador', 'Estado final', 'Total']) {
      expect(screen.getByRole('columnheader', { name: nombre })).toBeInTheDocument()
    }
    expect(screen.getByText('A-0001')).toBeInTheDocument()
    expect(screen.getAllByText('Histórico')).toHaveLength(2)
    expect(screen.getAllByText('10/03/2020')).toHaveLength(2)
    expect(screen.getAllByText('$ 412.300')[0].closest('td')).toHaveAttribute('class', expect.stringContaining('MuiTableCell-alignRight'))
    expect(screen.getByText('Deuda')).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Acciones' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /editar|anular|borrar|eliminar|exportar/i })).not.toBeInTheDocument()
    expect(screen.queryByText('v-1')).not.toBeInTheDocument()
  })

  it('Cobros: columnas del prototipo con «Histórico» y el importe con centavos', () => {
    abrir()
    fireEvent.click(screen.getByRole('tab', { name: 'Cobros' }))
    expect(ultimaLlamada()[0]).toBe('cobros')
    for (const nombre of ['Fecha', 'Comprobante', 'Tienda', 'Cliente', 'Cuenta de cobro', 'Aprobado por', 'Importe']) {
      expect(screen.getByRole('columnheader', { name: nombre })).toBeInTheDocument()
    }
    expect(screen.getByText('B-0001')).toBeInTheDocument()
    expect(screen.getByText('Histórico')).toBeInTheDocument()
    expect(screen.getByText('$ 64.200,5')).toBeInTheDocument()
    expect(screen.getByText('Caja del local')).toBeInTheDocument()
  })

  it('muestra el rango Desde/Hasta, el contador y «Página N»', () => {
    mocks.useHistorialVentasCobros.mockReturnValue(respuesta([venta(1), venta(2)], { total: 60, pagina: 2 }))
    abrir()
    expect(screen.getByText('Desde: 10/01/2020')).toBeInTheDocument()
    expect(screen.getByText('Hasta: 11/03/2020')).toBeInTheDocument()
    expect(screen.getByText('60 registros mostrados')).toBeInTheDocument()
    expect(screen.getByText(/Página 2/)).toBeInTheDocument()
  })

  it('la búsqueda y el cambio de página van al hook', () => {
    mocks.useHistorialVentasCobros.mockReturnValue(respuesta([venta(1)], { total: 60 }))
    abrir()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar por cliente o número' }), { target: { value: 'pérez' } })
    expect(mocks.setTexto).toHaveBeenCalledWith('pérez')
    fireEvent.click(screen.getByRole('button', { name: /siguiente|next/i }))
    expect(mocks.setPagina).toHaveBeenCalledWith(2)
  })

  it('el filtro Tienda ofrece solo las empresas asignadas, reinicia la página y se conserva entre pestañas', () => {
    abrir()
    const grupo = screen.getByRole('group', { name: 'Filtrar por tienda' })
    expect(within(grupo).getAllByRole('button').map((b) => b.textContent)).toEqual(['Todas las tiendas', 'San Javucho', 'Mundo JC'])
    expect(ultimaLlamada()[1]).toBe('')
    fireEvent.click(within(grupo).getByRole('button', { name: 'Mundo JC' }))
    expect(ultimaLlamada()).toEqual(['ventas', 'e-2'])
    expect(mocks.setPagina).toHaveBeenCalledWith(1)
    fireEvent.click(screen.getByRole('tab', { name: 'Cobros' }))
    expect(ultimaLlamada()).toEqual(['cobros', 'e-2'])
    expect(within(screen.getByRole('group', { name: 'Filtrar por tienda' })).getByRole('button', { name: 'Mundo JC' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('el filtro Tienda sigue a la empresa activa y, al cambiar de empresa u organización, se descarta el chip y se recarga', () => {
    mocks.useEmpresasAccesibles.mockReturnValue(empresasAccesibles('e-1'))
    const { rerender } = abrir()
    expect(ultimaLlamada()).toEqual(['ventas', 'e-1'])
    fireEvent.click(within(screen.getByRole('group', { name: 'Filtrar por tienda' })).getByRole('button', { name: 'Mundo JC' }))
    expect(ultimaLlamada()).toEqual(['ventas', 'e-2'])
    // Cambia la empresa activa de la barra: gana la barra y el hook se remonta (página 1).
    mocks.useEmpresasAccesibles.mockReturnValue(empresasAccesibles('e-2'))
    mocks.useHistorialVentasCobros.mockClear()
    rerender(<MemoryRouter><HistorialList /></MemoryRouter>)
    expect(ultimaLlamada()).toEqual(['ventas', 'e-2'])
    expect(within(screen.getByRole('group', { name: 'Filtrar por tienda' })).getByRole('button', { name: 'Mundo JC' })).toHaveAttribute('aria-pressed', 'true')
    // Cambia la organización: sin empresa activa propia el filtro vuelve a «Todas».
    fireEvent.click(within(screen.getByRole('group', { name: 'Filtrar por tienda' })).getByRole('button', { name: 'San Javucho' }))
    mocks.useEmpresasAccesibles.mockReturnValue(empresasAccesibles(null))
    mocks.useOrganizacionActiva.mockReturnValue({ organizacionActiva: { id: 'o-2', nombre: 'Org 2' }, isLoading: false })
    rerender(<MemoryRouter><HistorialList /></MemoryRouter>)
    expect(ultimaLlamada()).toEqual(['ventas', ''])
    expect(within(screen.getByRole('group', { name: 'Filtrar por tienda' })).getByRole('button', { name: 'Todas las tiendas' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('página fuera de rango: no muestra «Sin resultados» mientras el hook vuelve a la 1, y solo la pestaña activa lleva aria-controls', () => {
    mocks.useHistorialVentasCobros.mockReturnValue(respuesta([], { pagina: 3, total: 0 }))
    abrir()
    expect(screen.queryByText('Sin resultados')).not.toBeInTheDocument()
    expect(screen.queryByText('Todavía no hay historial importado.')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Ventas' })).toHaveAttribute('aria-controls', 'historial-panel-ventas')
    expect(screen.getByRole('tab', { name: 'Cobros' })).not.toHaveAttribute('aria-controls')
  })

  it('estado de carga, error con «Reintentar», sin resultados y vacío', () => {
    mocks.useHistorialVentasCobros.mockReturnValue(respuesta([], { isLoading: true }))
    const { unmount } = abrir()
    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
    unmount()

    mocks.useHistorialVentasCobros.mockReturnValue(respuesta([], { isError: true }))
    const error = abrir()
    expect(screen.getByText('No pudimos cargar el historial de ventas.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(mocks.refetch).toHaveBeenCalledTimes(1)
    error.unmount()

    mocks.useHistorialVentasCobros.mockReturnValue(respuesta([], { textoAplicado: 'zzz' }))
    const sinResultados = abrir()
    expect(screen.getByText('Sin resultados')).toBeInTheDocument()
    sinResultados.unmount()

    mocks.useHistorialVentasCobros.mockReturnValue(respuesta([], { desde: null, hasta: null }))
    abrir()
    expect(screen.getByText('Todavía no hay historial importado.')).toBeInTheDocument()
    expect(screen.queryByText(/Desde:/)).not.toBeInTheDocument()
  })

  it('en angosto muestra tarjetas con los mismos datos', () => {
    mockAnchoPantalla(true)
    abrir()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByText('A-0001')).toBeInTheDocument()
    expect(screen.getAllByText('Histórico')).toHaveLength(2)
  })

  it('es operable con teclado: pestañas con rol, panel asociado y chips como botones', () => {
    abrir()
    const pestana = screen.getByRole('tab', { name: 'Ventas' })
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', pestana.id)
    expect(screen.getByRole('tablist', { name: 'Secciones del historial' })).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Filtrar por tienda' })).getAllByRole('button')[0]).toHaveAttribute('aria-pressed', 'true')
  })
})
