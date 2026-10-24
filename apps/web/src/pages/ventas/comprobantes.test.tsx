import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Test de INTEGRACIÓN de la pantalla (listado + filtros + tienda + exportación): se sube el timeout del archivo.
vi.setConfig({ testTimeout: 20000 })

const mocks = vi.hoisted(() => ({
  listarComprobantes: vi.fn(),
  listarOperadoresComprobantes: vi.fn(),
  listarFormasPago: vi.fn(),
  listarFormasEnvio: vi.fn(),
  exportarInmediato: vi.fn(),
  solicitarExportacionDiferida: vi.fn(),
  descargarExportacionDiferida: vi.fn(),
  descargarArchivo: vi.fn(),
  useEmpresasAccesibles: vi.fn(),
  useNivelSeccion: vi.fn(),
  useOrganizacionActiva: vi.fn(),
  usePuedeAccion: vi.fn(),
  useIsSuperadmin: vi.fn(),
  useOrganizacionDeTrabajo: vi.fn(),
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
}))

vi.mock('../../lib/ventasComprobantes', async (importar) => ({
  ...(await importar<typeof import('../../lib/ventasComprobantes')>()),
  listarComprobantes: mocks.listarComprobantes,
  listarOperadoresComprobantes: mocks.listarOperadoresComprobantes,
}))
vi.mock('../../lib/ventas/formasPago', async (importar) => ({
  ...(await importar<typeof import('../../lib/ventas/formasPago')>()),
  listarFormasPago: mocks.listarFormasPago,
}))
vi.mock('../../lib/ventas/formasEnvio', async (importar) => ({
  ...(await importar<typeof import('../../lib/ventas/formasEnvio')>()),
  listarFormasEnvio: mocks.listarFormasEnvio,
}))
vi.mock('../../lib/exportarComprobantes', async (importar) => ({
  ...(await importar<typeof import('../../lib/exportarComprobantes')>()),
  exportarInmediato: mocks.exportarInmediato,
  solicitarExportacionDiferida: mocks.solicitarExportacionDiferida,
  descargarExportacionDiferida: mocks.descargarExportacionDiferida,
  descargarArchivo: mocks.descargarArchivo,
}))
vi.mock('../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: mocks.useEmpresasAccesibles }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: mocks.useOrganizacionActiva }))
vi.mock('../../hooks/usePuedeAccion', () => ({ usePuedeAccion: mocks.usePuedeAccion }))
vi.mock('../../hooks/useIsSuperadmin', () => ({ useIsSuperadmin: mocks.useIsSuperadmin }))
vi.mock('../../hooks/useOrganizacionDeTrabajo', () => ({ useOrganizacionDeTrabajo: mocks.useOrganizacionDeTrabajo }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

vi.mock('../../lib/supabase', () => {
  const cadena: Record<string, unknown> = {}
  for (const metodo of ['from', 'select', 'eq']) cadena[metodo] = () => cadena
  cadena.maybeSingle = mocks.maybeSingle
  return { supabaseClient: { ...cadena, auth: { getUser: mocks.getUser } } }
})

import type { ComprobanteListado } from '../../lib/ventasComprobantes'
import { RequiereAccesoSeccion } from '../../components/RequiereAccesoSeccion'
import { ComprobantesList } from './comprobantes'

const comprobante = (n: number, extra: Partial<ComprobanteListado> = {}): ComprobanteListado => ({
  id: `c-${n}`, numero: `0000000${n}`, tipo: 'factura', empresa_id: 'e-1', empresa: 'San Javucho', fecha: '2026-10-07',
  cliente: `Cliente ${n}`, operador: 'Emilse', estado: 'pendiente', forma_pago: 'Efectivo', envio: 'Retiro en local',
  total: 1240800, ...extra,
})
const pagina = (comprobantes: ComprobanteListado[], total = comprobantes.length) => ({ comprobantes, total })

const empresasAccesibles = (activa: string | null) => ({
  empresas: [
    { id: 'e-1', nombre: 'San Javucho', esActiva: activa === 'e-1', rolId: null },
    { id: 'e-2', nombre: 'Mundo JC', esActiva: activa === 'e-2', rolId: null },
  ],
  empresaActivaId: activa, isLoading: false, isError: false,
})

function Ubicacion() {
  const ubicacion = useLocation()
  return <p data-testid="ubicacion">{ubicacion.pathname}{ubicacion.search}</p>
}

const abrir = () =>
  render(
    <MemoryRouter initialEntries={['/ventas/comprobantes']}>
      <Routes>
        <Route path="/ventas/comprobantes" element={<ComprobantesList />} />
        <Route path="*" element={<Ubicacion />} />
      </Routes>
    </MemoryRouter>,
  )

const ultimoPedido = () => mocks.listarComprobantes.mock.calls.at(-1)![0]

function mockAnchoPantalla(angosta: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: angosta, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

describe('ComprobantesList (F-VTA-09, FR-001…FR-010)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockAnchoPantalla(false)
    mocks.useEmpresasAccesibles.mockReturnValue(empresasAccesibles('e-1'))
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.useOrganizacionActiva.mockReturnValue({ organizacionActiva: { id: 'o-1', nombre: 'Org 1' }, isLoading: false })
    mocks.usePuedeAccion.mockReturnValue({ puede: true, isLoading: false })
    mocks.useIsSuperadmin.mockReturnValue({ isSuperadmin: false, isLoading: false })
    mocks.useOrganizacionDeTrabajo.mockReturnValue({ organizacionId: 'o-1', isLoading: false })
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'u-1' } } })
    mocks.maybeSingle.mockResolvedValue({ data: { rol_id: 'consulta' }, error: null })
    mocks.listarComprobantes.mockResolvedValue(pagina([comprobante(1), comprobante(2, { estado: 'aceptado', tipo: 'nota_credito', total: -5000.5 })]))
    mocks.listarOperadoresComprobantes.mockResolvedValue([{ id: 'u-9', nombre: 'Emilse' }])
    mocks.listarFormasPago.mockResolvedValue([{ id: 'fp-1', nombre: 'Efectivo', empresa_id: 'e-1' }])
    mocks.listarFormasEnvio.mockResolvedValue([{ id: 'fe-1', nombre: 'Retiro en local', empresa_id: 'e-1' }])
    mocks.exportarInmediato.mockResolvedValue({ archivo: new Blob(['x']), filas: 2 })
    mocks.solicitarExportacionDiferida.mockResolvedValue('ej-1')
  })

  it('muestra título, subtítulo, las columnas del prototipo, chips y el contador', async () => {
    abrir()
    expect(await screen.findByText('Cliente 1')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Comprobantes', level: 1 })).toBeInTheDocument()
    expect(screen.getByText(/Facturas y remitos de ventas internas/)).toBeInTheDocument()
    for (const nombre of ['Comprobante', 'Tienda', 'Fecha', 'Cliente', 'Operador', 'Estado', 'Pago', 'Envío', 'Total']) {
      expect(screen.getByRole('columnheader', { name: nombre })).toBeInTheDocument()
    }
    expect(screen.queryByRole('columnheader', { name: 'Acciones' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '00000001' })).toHaveAttribute('href', '/ventas/comprobantes/c-1')
    expect(screen.getAllByText('07/10/2026').length).toBeGreaterThan(0)
    expect(screen.getByText('Pendiente', { selector: '.MuiChip-label' })).toBeInTheDocument()
    expect(screen.getByText('Aceptado', { selector: '.MuiChip-label' })).toBeInTheDocument()
    expect(screen.getAllByText('$ 1.240.800').length).toBe(1)
    expect(screen.getByText('$ -5.000,5')).toBeInTheDocument()
    expect(screen.getByText('2 comprobantes')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Comprobantes' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Presupuestos' })).toHaveAttribute('href', '/ventas/presupuestos')
  })

  it('busca por cliente o número esperando a que se deje de tipear y vuelve a la página 1', async () => {
    abrir()
    await screen.findByText('Cliente 1')
    fireEvent.change(screen.getByLabelText('Buscar por cliente o número'), { target: { value: 'Norte' } })
    await waitFor(() => expect(ultimoPedido()).toMatchObject({ busqueda: 'Norte' }))
    expect(mocks.listarComprobantes.mock.calls.at(-1)![1]).toBe(1)
  })

  it('filtra por Estado, Pago, Envío y Operador, y «Limpiar filtros» restablece', async () => {
    abrir()
    await screen.findByText('Cliente 1')

    fireEvent.click(screen.getByRole('button', { name: /^Estado:/ }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Aceptado' }))
    await waitFor(() => expect(ultimoPedido()).toMatchObject({ estado: 'aceptado' }))

    fireEvent.click(screen.getByRole('button', { name: /^Pago:/ }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Efectivo' }))
    await waitFor(() => expect(ultimoPedido()).toMatchObject({ pagoId: 'fp-1' }))

    fireEvent.click(screen.getByRole('button', { name: /^Envío:/ }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Retiro en local' }))
    await waitFor(() => expect(ultimoPedido()).toMatchObject({ envioId: 'fe-1' }))

    fireEvent.click(screen.getByRole('button', { name: /^Operador:/ }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Emilse' }))
    await waitFor(() => expect(ultimoPedido()).toMatchObject({ operadorId: 'u-9' }))

    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    await waitFor(() => expect(ultimoPedido()).toMatchObject({ busqueda: '', estado: '', pagoId: '', envioId: '', operadorId: '' }))
    expect(screen.getByLabelText('Buscar por cliente o número')).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Limpiar filtros' })).not.toBeInTheDocument()
  })

  it('sin resultados con filtros muestra «Sin resultados» y su ayuda', async () => {
    abrir()
    await screen.findByText('Cliente 1')
    mocks.listarComprobantes.mockResolvedValue(pagina([]))
    fireEvent.click(screen.getByRole('button', { name: /^Estado:/ }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Aceptado' }))
    expect(await screen.findByText('Sin resultados')).toBeInTheDocument()
    expect(screen.getByText('Probá con otra búsqueda o limpiá los filtros.')).toBeInTheDocument()
  })

  it('sin comprobantes ni filtros invita a crear el primero', async () => {
    mocks.listarComprobantes.mockResolvedValue(pagina([]))
    abrir()
    expect(await screen.findByText('Todavía no hay comprobantes.')).toBeInTheDocument()
  })

  it('si falla la carga muestra el error y permite reintentar', async () => {
    mocks.listarComprobantes.mockRejectedValueOnce(new Error('caída'))
    abrir()
    expect(await screen.findByText('No pudimos cargar los comprobantes.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Cliente 1')).toBeInTheDocument()
  })

  it('el filtro Tienda arranca en la empresa activa, muestra su texto y lo elegido viaja al servidor', async () => {
    abrir()
    await screen.findByText('Cliente 1')
    expect(ultimoPedido()).toMatchObject({ empresaId: 'e-1' })
    expect(screen.getByText('Por defecto se ven todas; si elegís una empresa en la barra superior, se filtra por esa tienda.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'San Javucho' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Mundo JC' }))
    await waitFor(() => expect(ultimoPedido()).toMatchObject({ empresaId: 'e-2' }))
    expect(mocks.listarComprobantes.mock.calls.at(-1)![1]).toBe(1)
  })

  it('al cambiar la empresa activa de la barra recarga acotado a ella y no deja filas de la anterior', async () => {
    mocks.listarComprobantes.mockImplementation(async ({ empresaId }: { empresaId: string }) =>
      empresaId === 'e-2'
        ? pagina([comprobante(7, { empresa_id: 'e-2', empresa: 'Mundo JC', cliente: 'Cliente de JC' })])
        : pagina([comprobante(1)]),
    )
    const vista = abrir()
    await screen.findByText('Cliente 1')

    mocks.useEmpresasAccesibles.mockReturnValue(empresasAccesibles('e-2'))
    vista.rerender(
      <MemoryRouter initialEntries={['/ventas/comprobantes']}>
        <Routes>
          <Route path="/ventas/comprobantes" element={<ComprobantesList />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('Cliente de JC')).toBeInTheDocument()
    expect(screen.queryByText('Cliente 1')).not.toBeInTheDocument()
    await waitFor(() => expect(ultimoPedido()).toMatchObject({ empresaId: 'e-2' }))
    expect(screen.getByRole('button', { name: 'Mundo JC' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('«Exportar» con hasta 10.000 filas descarga el CSV y avisa', async () => {
    abrir()
    await screen.findByText('Cliente 1')
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }))
    expect(await screen.findByText('Exportación lista: el archivo se descargó.')).toBeInTheDocument()
    expect(mocks.exportarInmediato).toHaveBeenCalledWith('comprobantes', expect.objectContaining({ empresaId: 'e-1' }))
    expect(mocks.descargarArchivo).toHaveBeenCalledTimes(1)
    expect(mocks.solicitarExportacionDiferida).not.toHaveBeenCalled()
  })

  it('«Exportar» con más de 10.000 filas solicita la diferida y ofrece «Descargar» para quien la pidió', async () => {
    mocks.listarComprobantes.mockResolvedValue({ comprobantes: [comprobante(1)], total: 10001 })
    abrir()
    await screen.findByText('Cliente 1')
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }))
    expect(await screen.findByText(/Exportación solicitada/)).toBeInTheDocument()
    expect(mocks.solicitarExportacionDiferida).toHaveBeenCalledWith('comprobantes', expect.objectContaining({ empresaId: 'e-1' }))
    expect(screen.queryByRole('link', { name: /Ejecuciones/ })).not.toBeInTheDocument()
    mocks.descargarExportacionDiferida.mockResolvedValue(undefined)
    fireEvent.click(screen.getByRole('button', { name: 'Descargar' }))
    await waitFor(() => expect(mocks.descargarExportacionDiferida).toHaveBeenCalledWith('ej-1', expect.stringMatching(/^comprobantes-.*\.csv$/)))
    expect(mocks.exportarInmediato).not.toHaveBeenCalled()
  })

  it('«Descargar» avisa el motivo si la exportación todavía no terminó y deja reintentar', async () => {
    mocks.listarComprobantes.mockResolvedValue({ comprobantes: [comprobante(1)], total: 10001 })
    mocks.descargarExportacionDiferida.mockRejectedValue(new Error('Tu exportación todavía se está generando. Probá de nuevo en unos minutos.'))
    abrir()
    await screen.findByText('Cliente 1')
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }))
    await screen.findByText(/Exportación solicitada/)
    fireEvent.click(screen.getByRole('button', { name: 'Descargar' }))
    expect(await screen.findByText(/todavía se está generando/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Descargar' })).toBeInTheDocument()
  })

  it('«Exportar» sin filas avisa «Sin resultados» y no descarga nada', async () => {
    mocks.listarComprobantes.mockResolvedValue(pagina([]))
    abrir()
    await screen.findByText('Todavía no hay comprobantes.')
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }))
    expect(await screen.findByText(/Sin resultados: no hay filas para exportar/)).toBeInTheDocument()
    expect(mocks.exportarInmediato).not.toHaveBeenCalled()
    expect(mocks.descargarArchivo).not.toHaveBeenCalled()
  })

  it('sin permiso de exportar no ofrece el botón; con lectura tampoco «Nuevo comprobante»', async () => {
    mocks.usePuedeAccion.mockReturnValue({ puede: false, isLoading: false })
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    abrir()
    await screen.findByText('Cliente 1')
    expect(screen.queryByRole('button', { name: 'Exportar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Nuevo comprobante' })).not.toBeInTheDocument()
  })

  it('sin acceso a la sección muestra «Acceso restringido» y no monta el listado', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'ninguno', isLoading: false })
    render(
      <MemoryRouter>
        <RequiereAccesoSeccion seccion="ventas"><ComprobantesList /></RequiereAccesoSeccion>
      </MemoryRouter>,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('Sección no disponible para tu rol')
    expect(screen.queryByRole('heading', { name: 'Comprobantes' })).not.toBeInTheDocument()
    expect(mocks.listarComprobantes).not.toHaveBeenCalled()
  })

  it('en pantallas angostas conserva los datos en tarjetas', async () => {
    mockAnchoPantalla(true)
    abrir()
    await screen.findByText('Cliente 1')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getAllByText('Cliente 1').length).toBeGreaterThan(0)
  })

  it('el buscador y los filtros son accesibles por teclado y lector', async () => {
    abrir()
    await screen.findByText('Cliente 1')
    const buscador = screen.getByRole('searchbox', { name: 'Buscar por cliente o número' })
    buscador.focus()
    expect(buscador).toHaveFocus()
    fireEvent.change(buscador, { target: { value: 'Norte' } })
    expect(buscador).toHaveValue('Norte')

    const filtroEstado = screen.getByRole('button', { name: /^Estado:/ })
    fireEvent.click(filtroEstado)
    const menu = screen.getByRole('menu', { name: 'Filtrar por estado' })
    expect(within(menu).getAllByRole('menuitem')[0]).toHaveTextContent('Todos')
    fireEvent.keyDown(menu, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })
})
