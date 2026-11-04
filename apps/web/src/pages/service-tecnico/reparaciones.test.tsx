import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useNivelSeccion: vi.fn(),
  useEmpresasAccesibles: vi.fn(),
  rpc: vi.fn(),
  listarTecnicos: vi.fn(),
  usePuedeAccion: vi.fn(),
  descargarCsv: vi.fn(),
}))

vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/usePuedeAccion', () => ({ usePuedeAccion: mocks.usePuedeAccion }))
vi.mock('../../lib/exportarCsv', async (importarOriginal) => ({
  ...(await importarOriginal<typeof import('../../lib/exportarCsv')>()),
  descargarCsv: mocks.descargarCsv,
}))
vi.mock('../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: mocks.useEmpresasAccesibles }))
vi.mock('../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: { id: 'org-1' } }) }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))
vi.mock('../../lib/reparaciones', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/reparaciones')>()),
  listarTecnicos: mocks.listarTecnicos,
}))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import type { ReparacionListada } from '../../lib/reparacionesListado'
import { ServicioReparaciones } from './reparaciones'

const fila = (n: number, extra: Partial<ReparacionListada> = {}): ReparacionListada => ({
  id: `r-${n}`, numero: n, codigo: `R-${String(n).padStart(4, '0')}`, ingreso_en: '2026-10-05',
  empresa_id: 'e-1', empresa: 'San Javucho', cliente: `Cliente ${n}`, equipo: 'Nintendo Switch', modelo: 'Estándar',
  numero_serie: `SN-${n}`, estado: 'En reparación', estado_tono: 'info', tecnico_id: 't-1', tecnico: 'Ana Pérez',
  entrega_prevista: '2026-10-25', total_cliente: 15000, pendientes_stock: 0, ...extra,
})

const responder = (filas: ReparacionListada[], total = filas.length) =>
  mocks.rpc.mockResolvedValue({ data: { total_filas: total, filas }, error: null })

const ultimaLlamada = () => mocks.rpc.mock.calls.at(-1)![1] as Record<string, unknown>

function mockAnchoPantalla(coincideAngosta: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: coincideAngosta, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

const abrir = () => render(<MemoryRouter><ServicioReparaciones /></MemoryRouter>)

describe('Service técnico · Reparaciones (F-SVC-04)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAnchoPantalla(false)
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.usePuedeAccion.mockReturnValue({ puede: false, isLoading: false })
    mocks.useEmpresasAccesibles.mockReturnValue({ empresas: [], empresaActivaId: null, isLoading: false, isError: false })
    mocks.listarTecnicos.mockResolvedValue([{ user_id: 't-1', nombre: 'Ana Pérez' }, { user_id: 't-2', nombre: 'Luis Gómez' }])
    responder([fila(238, { total_cliente: 0, numero_serie: null, tecnico: null, tecnico_id: null, entrega_prevista: null }), fila(237)])
  })

  afterEach(() => vi.useRealTimers())

  it('muestra las nueve columnas, el contador y el subtítulo del período', async () => {
    abrir()
    expect(await screen.findByText('2 reparaciones')).toBeInTheDocument()
    const tabla = screen.getByRole('table', { name: 'Reparaciones' })
    for (const encabezado of ['Reparación', 'Tienda', 'Cliente', 'Equipo', 'N.º de serie', 'Estado', 'Técnico', 'Entrega', 'Total']) {
      expect(within(tabla).getByRole('columnheader', { name: encabezado })).toBeInTheDocument()
    }
    expect(screen.getByText(/Según la fecha de entrega prevista \(hoy: \d{2}\/\d{2}\/\d{4}\)/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'R-0237' })).toHaveAttribute('href', '/service-tecnico/reparaciones/r-237')
    expect(screen.getAllByText('Ingreso 05/10')).toHaveLength(2)
    expect(screen.getAllByText('Estándar')).toHaveLength(2)
    expect(screen.getByText('25/10/2026')).toBeInTheDocument()
    expect(screen.getAllByText('En reparación', { selector: '.MuiChip-label' })).toHaveLength(2)
  })

  it('muestra «A presupuestar» sin ítems y «—» donde falta el dato', async () => {
    abrir()
    await screen.findByText('2 reparaciones')
    const filaSinDatos = screen.getByRole('link', { name: 'R-0238' }).closest('tr')!
    expect(within(filaSinDatos).getByText('A presupuestar')).toBeInTheDocument()
    expect(within(filaSinDatos).getAllByText('—')).toHaveLength(3)
    const filaConTotal = screen.getByRole('link', { name: 'R-0237' }).closest('tr')!
    expect(within(filaConTotal).getByText(/15\.000/)).toBeInTheDocument()
  })

  it('indica «Pendiente de stock» solo en las reparaciones con repuestos pendientes (FR-032)', async () => {
    responder([fila(238, { pendientes_stock: 2 }), fila(237)])
    abrir()
    await screen.findByText('2 reparaciones')
    const conPendiente = screen.getByRole('link', { name: 'R-0238' }).closest('tr')!
    const sinPendiente = screen.getByRole('link', { name: 'R-0237' }).closest('tr')!
    expect(within(conPendiente).getByText('Pendiente de stock')).toBeInTheDocument()
    expect(within(sinPendiente).queryByText('Pendiente de stock')).not.toBeInTheDocument()
  })

  it('arranca en el período Mes, página 1 y con la empresa activa de la barra superior', async () => {
    mocks.useEmpresasAccesibles.mockReturnValue({ empresas: [], empresaActivaId: 'e-1', isLoading: false, isError: false })
    abrir()
    await screen.findByText('2 reparaciones')
    expect(ultimaLlamada()).toMatchObject({ p_empresa: 'e-1', p_periodo: 'mes', p_serie: null, p_tecnico: null, p_pagina: 1, p_tamano: 25 })
    expect(screen.getByRole('button', { name: 'Mes' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('con «todas mis empresas» no filtra por tienda', async () => {
    abrir()
    await screen.findByText('2 reparaciones')
    expect(ultimaLlamada().p_empresa).toBeNull()
  })

  it('los chips Hoy y Semana cambian el período que viaja al servidor', async () => {
    abrir()
    await screen.findByText('2 reparaciones')
    fireEvent.click(screen.getByRole('button', { name: 'Hoy' }))
    await waitFor(() => expect(ultimaLlamada().p_periodo).toBe('hoy'))
    fireEvent.click(screen.getByRole('button', { name: 'Semana' }))
    await waitFor(() => expect(ultimaLlamada().p_periodo).toBe('semana'))
  })

  it('busca por N.º de serie esperando a que se deje de tipear', async () => {
    abrir()
    await screen.findByText('2 reparaciones')
    mocks.rpc.mockClear()
    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText('Buscar por N.º de serie'), { target: { value: 'abc' } })
    expect(mocks.rpc).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(350) })
    expect(ultimaLlamada().p_serie).toBe('abc')
    vi.useRealTimers()
    expect(await screen.findByText('La búsqueda por N.º de serie no depende del período.')).toBeInTheDocument()
  })

  it('filtra por técnico con los técnicos de Service', async () => {
    abrir()
    await screen.findByText('2 reparaciones')
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Técnico' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Luis Gómez' }))
    await waitFor(() => expect(ultimaLlamada().p_tecnico).toBe('t-2'))
  })

  it('avisa si no se pudieron cargar los técnicos y el listado sigue funcionando', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.listarTecnicos.mockRejectedValue(new Error('falló'))
    abrir()
    expect(await screen.findByText('No pudimos cargar los técnicos. Recargá la página para filtrar por técnico.')).toBeInTheDocument()
    expect(screen.getByText('2 reparaciones')).toBeInTheDocument()
    consola.mockRestore()
  })

  it('no muestra el aviso de técnicos cuando cargan bien', async () => {
    abrir()
    await screen.findByText('2 reparaciones')
    expect(screen.queryByText(/No pudimos cargar los técnicos/)).not.toBeInTheDocument()
  })

  it('pagina en el servidor y vuelve a la página 1 al cambiar un filtro', async () => {
    responder([fila(1), fila(2)], 60)
    abrir()
    await screen.findByText('60 reparaciones')
    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente/i }))
    await waitFor(() => expect(ultimaLlamada().p_pagina).toBe(2))
    fireEvent.click(screen.getByRole('button', { name: 'Hoy' }))
    await waitFor(() => expect(ultimaLlamada()).toMatchObject({ p_periodo: 'hoy', p_pagina: 1 }))
  })

  it('al cambiar de empresa activa vuelve a la página 1 y no muestra filas de la anterior', async () => {
    responder([fila(1, { empresa: 'San Javucho' })], 60)
    mocks.useEmpresasAccesibles.mockReturnValue({ empresas: [], empresaActivaId: 'e-1', isLoading: false, isError: false })
    const { rerender } = abrir()
    await screen.findByText('60 reparaciones')
    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente/i }))
    await waitFor(() => expect(ultimaLlamada().p_pagina).toBe(2))

    let resolver: (valor: unknown) => void = () => {}
    mocks.rpc.mockReturnValue(new Promise((resuelto) => { resolver = resuelto }))
    mocks.useEmpresasAccesibles.mockReturnValue({ empresas: [], empresaActivaId: 'e-2', isLoading: false, isError: false })
    rerender(<MemoryRouter><ServicioReparaciones /></MemoryRouter>)
    await waitFor(() => expect(ultimaLlamada()).toMatchObject({ p_empresa: 'e-2', p_pagina: 1 }))
    expect(screen.queryByText('R-0001')).not.toBeInTheDocument()
    expect(screen.queryByText('San Javucho')).not.toBeInTheDocument()
    await act(async () => {
      resolver({ data: { total_filas: 1, filas: [fila(9, { empresa: 'Mundo JC', empresa_id: 'e-2' })] }, error: null })
    })
    expect(await screen.findByText('Mundo JC')).toBeInTheDocument()
  })

  it('mientras se resuelve la empresa activa no muestra filas', async () => {
    mocks.useEmpresasAccesibles.mockReturnValue({ empresas: [], empresaActivaId: null, isLoading: true, isError: false })
    abrir()
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled())
    expect(screen.queryByText('R-0237')).not.toBeInTheDocument()
  })

  it('un período sin reparaciones muestra el vacío del período', async () => {
    responder([])
    abrir()
    expect(await screen.findByText('No hay reparaciones en este período')).toBeInTheDocument()
  })

  it('una serie sin coincidencias muestra su propio vacío', async () => {
    abrir()
    await screen.findByText('2 reparaciones')
    responder([])
    fireEvent.change(screen.getByLabelText('Buscar por N.º de serie'), { target: { value: 'zzz' } })
    expect(await screen.findByText('No hay reparaciones con ese número de serie')).toBeInTheDocument()
  })

  it('muestra el estado de carga y luego el error con reintento', async () => {
    mocks.rpc.mockReturnValue(new Promise(() => {}))
    const { unmount } = abrir()
    expect(screen.getByLabelText('Cargando contenido')).toBeInTheDocument()
    unmount()

    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'XX000' } })
    abrir()
    expect(await screen.findByText('No pudimos cargar las reparaciones. Probá de nuevo.')).toBeInTheDocument()
    responder([fila(1)])
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('1 reparación')).toBeInTheDocument()
  })

  it('un rol sin permiso lo ve explicado', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
    abrir()
    expect(await screen.findByText(/Tu rol no puede ver las reparaciones/)).toBeInTheDocument()
  })

  it('en móvil muestra tarjetas con los mismos datos', async () => {
    mockAnchoPantalla(true)
    abrir()
    await screen.findByText('2 reparaciones')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'R-0237' })).toBeInTheDocument()
    expect(screen.getAllByText('Total')).toHaveLength(2)
  })

  it('ofrece «Nueva reparación» con edición y la oculta con lectura', async () => {
    const { unmount } = abrir()
    await screen.findByText('2 reparaciones')
    expect(screen.getByRole('heading', { name: 'Reparaciones' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Reparaciones' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Modelos' })).toHaveAttribute('href', '/service-tecnico/modelos')
    expect(screen.getByRole('link', { name: 'Nueva reparación' })).toHaveAttribute('href', '/service-tecnico/reparaciones/nueva')
    unmount()

    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    abrir()
    await screen.findByText('2 reparaciones')
    expect(screen.queryByRole('link', { name: 'Nueva reparación' })).not.toBeInTheDocument()
  })
})

// F-SVC-23 (FR-060/FR-061, SC-009): botón «Exportar» del listado.
describe('Service técnico · Exportar reparaciones (F-SVC-23)', () => {
  const LOTE = 200
  const filasDe = (desde: number, cantidad: number) => Array.from({ length: cantidad }, (_, i) => fila(desde + i))
  const contenidoDescargado = () => mocks.descargarCsv.mock.calls[0][0] as string
  const exportar = async () => {
    abrir()
    await screen.findByRole('table', { name: 'Reparaciones' })
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }))
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockAnchoPantalla(false)
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.usePuedeAccion.mockReturnValue({ puede: true, isLoading: false })
    mocks.useEmpresasAccesibles.mockReturnValue({ empresas: [], empresaActivaId: null, isLoading: false, isError: false })
    mocks.listarTecnicos.mockResolvedValue([{ user_id: 't-1', nombre: 'Ana Pérez' }])
    responder([fila(1), fila(2)])
  })

  it('el botón no se muestra sin la acción exportar', async () => {
    mocks.usePuedeAccion.mockReturnValue({ puede: false, isLoading: false })
    abrir()
    await screen.findByText('2 reparaciones')
    expect(screen.queryByRole('button', { name: 'Exportar' })).not.toBeInTheDocument()
  })

  it('pide la acción exportar de service_tecnico', async () => {
    abrir()
    await screen.findByText('2 reparaciones')
    expect(mocks.usePuedeAccion).toHaveBeenCalledWith('service_tecnico', 'exportar')
  })

  it('descarga reparaciones-AAAA-MM-DD.csv con las nueve columnas y sin costos', async () => {
    await exportar()
    await waitFor(() => expect(mocks.descargarCsv).toHaveBeenCalledTimes(1))
    const [contenido, nombre] = mocks.descargarCsv.mock.calls[0] as [string, string]
    expect(nombre).toMatch(/^reparaciones-\d{4}-\d{2}-\d{2}\.csv$/)
    const lineas = contenido.replace('\uFEFF', '').split('\r\n')
    expect(lineas[0]).toBe('Reparación;Tienda;Cliente;Equipo;N.º de serie;Estado;Técnico;Entrega;Total')
    expect(lineas[1].startsWith('R-0001;San Javucho;Cliente 1;Nintendo Switch Estándar;SN-1;En reparación;Ana Pérez;25/10/2026;')).toBe(true)
    expect(contenido).not.toMatch(/costo|ganancia/i)
  })

  it('exporta todas las filas del filtro, no solo la página (varios lotes de 200)', async () => {
    mocks.rpc.mockImplementation(async (_nombre: string, args: { p_pagina: number; p_tamano: number }) => {
      const desde = (args.p_pagina - 1) * args.p_tamano
      const total = 450
      return { data: { total_filas: total, filas: filasDe(desde + 1, Math.max(0, Math.min(args.p_tamano, total - desde))) }, error: null }
    })
    await exportar()
    await waitFor(() => expect(mocks.descargarCsv).toHaveBeenCalledTimes(1))
    expect(contenidoDescargado().split('\r\n').filter(Boolean)).toHaveLength(451)
    expect(mocks.rpc.mock.calls.some(([, args]) => (args as { p_tamano: number }).p_tamano === LOTE)).toBe(true)
  })

  it('congela los filtros y la empresa activa al pulsar: un cambio posterior no altera el archivo', async () => {
    mocks.useEmpresasAccesibles.mockReturnValue({ empresas: [], empresaActivaId: 'e-1', isLoading: false, isError: false })
    abrir()
    await screen.findByText('2 reparaciones')
    fireEvent.click(screen.getByRole('button', { name: 'Semana' }))
    await waitFor(() => expect(ultimaLlamada().p_periodo).toBe('semana'))
    mocks.rpc.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }))
    await waitFor(() => expect(mocks.descargarCsv).toHaveBeenCalledTimes(1))
    const deLaExportacion = mocks.rpc.mock.calls.filter(([, args]) => (args as { p_tamano: number }).p_tamano === LOTE)
    expect(deLaExportacion.length).toBeGreaterThan(0)
    for (const [, args] of deLaExportacion) expect(args).toMatchObject({ p_empresa: 'e-1', p_periodo: 'semana', p_serie: null, p_tecnico: null })
  })

  it('sin filas descarga solo los encabezados y avisa que no hay nada para exportar', async () => {
    responder([], 0)
    abrir()
    await screen.findByText('0 reparaciones')
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }))
    await waitFor(() => expect(mocks.descargarCsv).toHaveBeenCalledTimes(1))
    expect(contenidoDescargado().replace('\uFEFF', '').trim().split('\r\n')).toHaveLength(1)
    expect(await screen.findByText(/No hay filas para exportar/)).toBeInTheDocument()
  })

  it('si falla no descarga nada y ofrece «Reintentar»', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => {})
    abrir()
    await screen.findByText('2 reparaciones')
    mocks.rpc.mockRejectedValue(new Error('caído'))
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }))
    expect(await screen.findByText(/No pudimos exportar/)).toBeInTheDocument()
    expect(mocks.descargarCsv).not.toHaveBeenCalled()
    responder([fila(1)])
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(mocks.descargarCsv).toHaveBeenCalledTimes(1))
    consola.mockRestore()
  })

  it('avisa cuando se alcanza el tope de 100.000 filas', async () => {
    mocks.rpc.mockImplementation(async (_nombre: string, args: { p_pagina: number; p_tamano: number }) => ({
      data: { total_filas: 100001, filas: filasDe((args.p_pagina - 1) * args.p_tamano + 1, args.p_tamano) }, error: null,
    }))
    await exportar()
    expect(await screen.findByText(/Se exportaron las primeras 100\.000 filas/, undefined, { timeout: 20000 })).toBeInTheDocument()
    expect(mocks.descargarCsv).toHaveBeenCalledTimes(1)
  }, 30000)
})
