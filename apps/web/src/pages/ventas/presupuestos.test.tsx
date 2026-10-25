import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Test de INTEGRACIÓN de la pantalla (listado + filtros + acciones): se sube el timeout del archivo.
vi.setConfig({ testTimeout: 20000 })

const mocks = vi.hoisted(() => ({
  listarPresupuestos: vi.fn(),
  aceptarPresupuesto: vi.fn(),
  copiarPresupuesto: vi.fn(),
  useEmpresasAccesibles: vi.fn(),
  useNivelSeccion: vi.fn(),
  useOrganizacionActiva: vi.fn(),
}))

vi.mock('../../lib/ventasPresupuestos', async (importar) => ({
  ...(await importar<typeof import('../../lib/ventasPresupuestos')>()),
  listarPresupuestos: mocks.listarPresupuestos,
  aceptarPresupuesto: mocks.aceptarPresupuesto,
  copiarPresupuesto: mocks.copiarPresupuesto,
}))
vi.mock('../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: mocks.useEmpresasAccesibles }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: mocks.useOrganizacionActiva }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import type { Presupuesto } from '../../lib/ventasPresupuestos'
import { PresupuestosList } from './presupuestos'

const presupuesto = (n: number, extra: Partial<Presupuesto> = {}): Presupuesto => ({
  id: `p-${n}`, numero: `0000000${n}`, empresa_id: 'e-1', empresa: 'San Javucho', fecha: '2026-10-07', cliente: `Cliente ${n}`,
  operador: 'Emilse', valido_hasta: '2026-10-21', estado: 'pendiente', total: 1240800, puede_editar: true, ...extra,
})
const pagina = (presupuestos: Presupuesto[], total = presupuestos.length) => ({ presupuestos, total })

const empresasAccesibles = (activa: string | null) => ({
  empresas: [{ id: 'e-1', nombre: 'San Javucho', esActiva: activa === 'e-1', rolId: null }, { id: 'e-2', nombre: 'Mundo JC', esActiva: activa === 'e-2', rolId: null }],
  empresaActivaId: activa, isLoading: false, isError: false,
})

function Ubicacion() {
  const ubicacion = useLocation()
  return <p data-testid="ubicacion">{ubicacion.pathname}{ubicacion.search}</p>
}
const abrir = () =>
  render(
    <MemoryRouter initialEntries={['/ventas/presupuestos']}>
      <Routes>
        <Route path="/ventas/presupuestos" element={<PresupuestosList />} />
        <Route path="*" element={<Ubicacion />} />
      </Routes>
    </MemoryRouter>,
  )
const ultimoPedido = () => mocks.listarPresupuestos.mock.calls.at(-1)![0]

function mockAnchoPantalla(angosta: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: angosta, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

describe('PresupuestosList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockAnchoPantalla(false)
    mocks.useEmpresasAccesibles.mockReturnValue(empresasAccesibles(null))
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.useOrganizacionActiva.mockReturnValue({ organizacionActiva: { id: 'o-1', nombre: 'Org 1' }, isLoading: false })
    mocks.listarPresupuestos.mockResolvedValue(pagina([
      presupuesto(1),
      presupuesto(2, { estado: 'aceptado', valido_hasta: null, total: 86400.25 }),
      presupuesto(3, { estado: 'vencido' }),
    ]))
    mocks.aceptarPresupuesto.mockResolvedValue({ id: 'p-1', numero: '00000001', estado: 'aceptado' })
    mocks.copiarPresupuesto.mockResolvedValue({ id: 'p-9', numero: '00000009', estado: 'pendiente' })
  })

  it('muestra título, las columnas del prototipo y los datos con formato argentino', async () => {
    abrir()
    expect(await screen.findByText('Cliente 1')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Presupuestos', level: 1 })).toBeInTheDocument()
    for (const nombre of ['Presupuesto', 'Tienda', 'Fecha', 'Cliente', 'Operador', 'Válido hasta', 'Estado', 'Total', 'Acciones']) {
      expect(screen.getByRole('columnheader', { name: nombre })).toBeInTheDocument()
    }
    expect(screen.getByRole('link', { name: '00000001' })).toHaveAttribute('href', '/ventas/comprobantes/p-1')
    expect(screen.getAllByText('07/10/2026').length).toBeGreaterThan(0)
    expect(screen.getAllByText('21/10/2026').length).toBeGreaterThan(0)
    expect(screen.getByText('Pendiente', { selector: '.MuiChip-label' })).toBeInTheDocument()
    expect(screen.getByText('Aceptado', { selector: '.MuiChip-label' })).toBeInTheDocument()
    expect(screen.getByText('Vencido', { selector: '.MuiChip-label' })).toBeInTheDocument()
    expect(screen.getAllByText('$ 1.240.800')).toHaveLength(2)
    expect(screen.getByText('$ 86.400,25')).toBeInTheDocument()
    expect(screen.getByText('3 presupuestos')).toBeInTheDocument()
  })

  it('no ofrece Exportar, Facturar, Enviar por correo ni Imprimir (fuera de alcance)', async () => {
    abrir()
    await screen.findByText('Cliente 1')
    for (const nombre of [/Exportar/, /Facturar/, /correo/i, /Imprimir/]) {
      expect(screen.queryByRole('button', { name: nombre })).not.toBeInTheDocument()
    }
  })

  it('«Nuevo presupuesto» abre el alta de presupuesto y solo aparece con edición', async () => {
    abrir()
    await screen.findByText('Cliente 1')
    expect(screen.getByRole('link', { name: 'Nuevo presupuesto' })).toHaveAttribute('href', '/ventas/comprobantes/nuevo?tipo=presupuesto')
  })

  it('con lectura se ve el listado pero no hay «Nuevo presupuesto» ni acciones', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    mocks.listarPresupuestos.mockResolvedValue(pagina([presupuesto(1, { puede_editar: false })]))
    abrir()
    await screen.findByText('Cliente 1')
    expect(screen.queryByRole('link', { name: 'Nuevo presupuesto' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Aceptar|Copiar|Modificar/ })).not.toBeInTheDocument()
  })

  it('acciones por estado: pendiente acepta, copia y modifica; aceptado y vencido solo copian', async () => {
    abrir()
    await screen.findByText('Cliente 1')
    expect(screen.getByRole('button', { name: 'Aceptar 00000001' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Copiar 00000001' })).toBeEnabled()
    expect(screen.getByRole('link', { name: 'Modificar 00000001' })).toHaveAttribute('href', '/ventas/comprobantes/p-1')
    for (const numero of ['00000002', '00000003']) {
      expect(screen.getByRole('button', { name: `Aceptar ${numero}` })).toBeDisabled()
      expect(screen.getByRole('button', { name: `Modificar ${numero}` })).toBeDisabled()
      expect(screen.getByRole('button', { name: `Copiar ${numero}` })).toBeEnabled()
    }
  })

  it('Aceptar llama a la base, avisa el resultado y recarga el listado', async () => {
    abrir()
    await screen.findByText('Cliente 1')
    const llamadas = mocks.listarPresupuestos.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Aceptar 00000001' }))
    expect(await screen.findByText('Presupuesto 00000001 aceptado')).toBeInTheDocument()
    expect(mocks.aceptarPresupuesto).toHaveBeenCalledWith('p-1')
    await waitFor(() => expect(mocks.listarPresupuestos.mock.calls.length).toBeGreaterThan(llamadas))
  })

  it('si Aceptar falla muestra el error y no recarga como éxito', async () => {
    mocks.aceptarPresupuesto.mockRejectedValue({ code: '55000', message: 'x' })
    abrir()
    await screen.findByText('Cliente 1')
    fireEvent.click(screen.getByRole('button', { name: 'Aceptar 00000001' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('ya está cerrado')
    expect(screen.queryByText(/aceptado$/)).not.toBeInTheDocument()
  })

  it('Copiar crea el presupuesto nuevo y abre su edición', async () => {
    abrir()
    await screen.findByText('Cliente 1')
    fireEvent.click(screen.getByRole('button', { name: 'Copiar 00000003' }))
    await waitFor(() => expect(screen.getByTestId('ubicacion')).toHaveTextContent('/ventas/comprobantes/p-9'))
    expect(mocks.copiarPresupuesto).toHaveBeenCalledWith('p-3')
  })

  it('si Copiar falla se queda en la lista con el error', async () => {
    mocks.copiarPresupuesto.mockRejectedValue({ code: '22023', message: 'El producto «Cable» ya no está activo' })
    abrir()
    await screen.findByText('Cliente 1')
    fireEvent.click(screen.getByRole('button', { name: 'Copiar 00000001' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('El producto «Cable» ya no está activo')
    expect(screen.queryByTestId('ubicacion')).not.toBeInTheDocument()
  })

  it('busca por cliente o número esperando a que se deje de tipear y vuelve a la página 1', async () => {
    abrir()
    await screen.findByText('Cliente 1')
    fireEvent.change(screen.getByLabelText('Buscar por cliente o número'), { target: { value: 'Norte' } })
    await waitFor(() => expect(ultimoPedido()).toMatchObject({ busqueda: 'Norte', pagina: 1 }))
  })

  it('filtra por estado con las píldoras del prototipo', async () => {
    abrir()
    await screen.findByText('Cliente 1')
    const grupo = screen.getByRole('group', { name: 'Filtrar por estado' })
    expect(within(grupo).getAllByRole('button').map((b) => b.textContent)).toEqual(['Todos', 'Pendiente', 'Aceptado', 'Vencido', 'Convertido en factura'])
    fireEvent.click(within(grupo).getByRole('button', { name: 'Vencido' }))
    await waitFor(() => expect(ultimoPedido()).toMatchObject({ estado: 'vencido', pagina: 1 }))
  })

  it('sin resultados con un filtro activo muestra «Sin resultados»', async () => {
    abrir()
    await screen.findByText('Cliente 1')
    mocks.listarPresupuestos.mockResolvedValue(pagina([]))
    fireEvent.click(within(screen.getByRole('group', { name: 'Filtrar por estado' })).getByRole('button', { name: 'Aceptado' }))
    expect(await screen.findByText('Sin resultados')).toBeInTheDocument()
  })

  it('sin presupuestos ni filtros invita a crear el primero', async () => {
    mocks.listarPresupuestos.mockResolvedValue(pagina([]))
    abrir()
    expect(await screen.findByText('Todavía no hay presupuestos.')).toBeInTheDocument()
  })

  it('si falla la carga muestra el error y permite reintentar', async () => {
    mocks.listarPresupuestos.mockRejectedValueOnce(new Error('caída'))
    abrir()
    expect(await screen.findByText('No pudimos cargar los presupuestos.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Cliente 1')).toBeInTheDocument()
  })

  it('el filtro de tienda muestra todas por defecto, con su texto, y lo elegido viaja al servidor', async () => {
    abrir()
    await screen.findByText('Cliente 1')
    expect(ultimoPedido().empresaId).toBeNull()
    expect(screen.getByText('Por defecto se ven todas; si elegís una empresa en la barra superior, se filtra por esa tienda.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Todas las tiendas' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Mundo JC' }))
    await waitFor(() => expect(ultimoPedido()).toMatchObject({ empresaId: 'e-2', pagina: 1 }))
  })

  it('al cambiar la empresa activa de la barra superior recarga acotado a ella y no deja filas de la anterior', async () => {
    mocks.listarPresupuestos.mockImplementation(async ({ empresaId }: { empresaId: string | null }) =>
      empresaId === 'e-2' ? pagina([presupuesto(7, { empresa_id: 'e-2', empresa: 'Mundo JC', cliente: 'Cliente de JC' })]) : pagina([presupuesto(1)]),
    )
    const vista = abrir()
    await screen.findByText('Cliente 1')
    fireEvent.change(screen.getByLabelText('Buscar por cliente o número'), { target: { value: 'algo' } })

    mocks.useEmpresasAccesibles.mockReturnValue(empresasAccesibles('e-2'))
    vista.rerender(
      <MemoryRouter initialEntries={['/ventas/presupuestos']}>
        <Routes>
          <Route path="/ventas/presupuestos" element={<PresupuestosList />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('Cliente de JC')).toBeInTheDocument()
    expect(screen.queryByText('Cliente 1')).not.toBeInTheDocument()
    expect(ultimoPedido()).toMatchObject({ empresaId: 'e-2', pagina: 1, busqueda: '' })
    expect(screen.getByRole('button', { name: 'Mundo JC' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Buscar por cliente o número')).toHaveValue('')
  })

  it('en pantallas angostas conserva las mismas acciones en tarjetas', async () => {
    mockAnchoPantalla(true)
    abrir()
    await screen.findByText('Cliente 1')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aceptar 00000001' })).toBeEnabled()
  })
})
