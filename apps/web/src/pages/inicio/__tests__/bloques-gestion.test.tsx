import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../test/axe'

// F-INI-05 (MSF-821): «Resumen por tienda», «Salidas por depósito» y «Actividad reciente» del tablero de Inicio.
const mocks = vi.hoisted(() => ({ bloques: vi.fn(), actividad: vi.fn() }))

vi.mock('../../../lib/inicioBloques', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/inicioBloques')>()),
  leerBloquesInicio: mocks.bloques,
  leerActividadReciente: mocks.actividad,
}))
vi.mock('../../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: { id: 'org-1' } }) }))

import { BloquesGestion } from '../tablero/BloquesGestion'

const CONTEXTO = { desde: '2026-10-01', hasta: '2026-10-15', empresaId: null, depositoId: null }

const BLOQUES = {
  por_tienda: [
    { empresa_id: 'e-1', nombre: 'San Javucho', unidades: 12, ingresos: 605000, margen_pct: 40 },
    { empresa_id: 'e-2', nombre: 'Mundo JC', unidades: 0, ingresos: 0, margen_pct: null },
  ],
  salidas_por_deposito: [
    { deposito_id: 'd-1', nombre: 'Central', salidas: 30, stock_actual: 130 },
    { deposito_id: 'd-2', nombre: 'Sucursal', salidas: 5, stock_actual: 20 },
  ],
}

const EVENTOS = [
  { id: 'ev-1', creadoEn: '2026-10-15T14:30:00Z', tipo: 'stock.entrada', empresaId: null, empresaNombre: null, actorId: 'u-1', actorNombre: 'Emilse', detalle: 'Entrada de Teclado: 5 unidades' },
  { id: 'ev-2', creadoEn: '2026-10-14T10:00:00Z', tipo: 'producto.creado', empresaId: null, empresaNombre: null, actorId: null, actorNombre: null, detalle: 'Alta de Mouse' },
]

const abrir = (props: Partial<{ verVentas: boolean; verStock: boolean; verActividad: boolean; contexto: typeof CONTEXTO }> = {}) =>
  render(
    <MemoryRouter>
      <BloquesGestion contexto={props.contexto ?? CONTEXTO} verVentas={props.verVentas ?? true} verStock={props.verStock ?? true} verActividad={props.verActividad ?? true} />
    </MemoryRouter>,
  )

beforeEach(() => {
  mocks.bloques.mockReset()
  mocks.bloques.mockResolvedValue(BLOQUES)
  mocks.actividad.mockReset()
  mocks.actividad.mockResolvedValue(EVENTOS)
})
afterEach(() => vi.unstubAllGlobals())

describe('Resumen por tienda (FR-008, CA-INI-05-3/4/9)', () => {
  it('muestra una fila por tienda con unidades, ingresos y margen estimado rotulado', async () => {
    abrir()
    const lista = await screen.findByRole('list', { name: 'Resumen por tienda' })
    expect(within(lista).getByText('San Javucho')).toBeInTheDocument()
    expect(within(lista).getByText('12 u.')).toBeInTheDocument()
    expect(within(lista).getAllByText(/Ingresos \(con IVA\)/)).toHaveLength(2)
    expect(within(lista).getByText(/Margen estimado: 40 %/)).toBeInTheDocument()
  })

  it('una tienda sin ventas queda como fila con ceros, no oculta', async () => {
    abrir()
    const lista = await screen.findByRole('list', { name: 'Resumen por tienda' })
    expect(within(lista).getByText('Mundo JC')).toBeInTheDocument()
    expect(within(lista).getByText('0 u.')).toBeInTheDocument()
    expect(within(lista).getByText(/sin costo cargado/)).toBeInTheDocument()
  })

  it('sin permiso de rentabilidad (ingresos y margen null) no se ve ninguno de los dos', async () => {
    mocks.bloques.mockResolvedValue({
      ...BLOQUES,
      por_tienda: BLOQUES.por_tienda.map((tienda) => ({ ...tienda, ingresos: null, margen_pct: null })),
    })
    abrir()
    const lista = await screen.findByRole('list', { name: 'Resumen por tienda' })
    expect(within(lista).getByText('12 u.')).toBeInTheDocument()
    expect(within(lista).queryByText(/Ingresos/)).not.toBeInTheDocument()
    expect(within(lista).queryByText(/Margen/)).not.toBeInTheDocument()
  })

  it('una tienda nueva aparece sin cambios de código (los nombres salen de los datos)', async () => {
    mocks.bloques.mockResolvedValue({
      ...BLOQUES,
      por_tienda: [...BLOQUES.por_tienda, { empresa_id: 'e-3', nombre: 'Tienda Nueva', unidades: 3, ingresos: 100, margen_pct: null }],
    })
    abrir()
    expect(await screen.findByText('Tienda Nueva')).toBeInTheDocument()
  })

  it('sin permiso de ventas el bloque ni se muestra', async () => {
    abrir({ verVentas: false })
    await screen.findByText('Salidas por depósito')
    expect(screen.queryByText('Resumen por tienda')).not.toBeInTheDocument()
  })
})

describe('Salidas por depósito (FR-009, CA-INI-05-5)', () => {
  it('muestra las unidades que salieron de cada depósito y su stock actual', async () => {
    abrir()
    const lista = await screen.findByRole('list', { name: 'Salidas por depósito' })
    expect(within(lista).getByText('Central')).toBeInTheDocument()
    expect(within(lista).getByText('30 u.')).toBeInTheDocument()
    expect(within(lista).getByText('Stock actual: 130 u.')).toBeInTheDocument()
    expect(within(lista).getByText('Sucursal')).toBeInTheDocument()
  })

  it('sin permiso de stock el bloque ni se muestra', async () => {
    abrir({ verStock: false })
    await screen.findByText('Resumen por tienda')
    expect(screen.queryByText('Salidas por depósito')).not.toBeInTheDocument()
  })
})

describe('Actividad reciente (FR-010, CA-INI-05-6)', () => {
  it('lista los eventos con fecha, usuario y enlace, el más reciente primero, y «Ver todo»', async () => {
    abrir()
    const lista = await screen.findByRole('list', { name: 'Actividad reciente' })
    const items = within(lista).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Entrada de Teclado: 5 unidades')
    expect(items[0]).toHaveTextContent('Emilse')
    expect(items[1]).toHaveTextContent('Sistema')
    expect(within(items[0]).getByRole('link', { name: /Ver en Actividad/ })).toHaveAttribute('href', '/actividad')
    expect(screen.getByRole('link', { name: 'Ver todo' })).toHaveAttribute('href', '/actividad')
    expect(screen.queryByText('Cant.')).not.toBeInTheDocument()
  })

  it('sin eventos muestra el estado vacío', async () => {
    mocks.actividad.mockResolvedValue([])
    abrir()
    expect(await screen.findByText('Sin actividad en este período')).toBeInTheDocument()
  })

  it('sin permiso de actividad no se consulta ni se muestra', async () => {
    abrir({ verActividad: false })
    await screen.findByText('Resumen por tienda')
    expect(mocks.actividad).not.toHaveBeenCalled()
    expect(screen.queryByText('Actividad reciente')).not.toBeInTheDocument()
  })
})

describe('Filtros y fallos por bloque (FR-011, CA-INI-05-7/8)', () => {
  it('cambiar la tienda recalcula los bloques con la nueva tienda', async () => {
    const vista = abrir()
    await screen.findByText('Resumen por tienda')
    expect(mocks.bloques).toHaveBeenCalledWith({ ...CONTEXTO })
    vista.rerender(
      <MemoryRouter>
        <BloquesGestion contexto={{ ...CONTEXTO, empresaId: 'e-1' }} verVentas verStock verActividad />
      </MemoryRouter>,
    )
    await waitFor(() => expect(mocks.bloques).toHaveBeenLastCalledWith({ ...CONTEXTO, empresaId: 'e-1' }))
    await waitFor(() => expect(mocks.actividad).toHaveBeenLastCalledWith({ ...CONTEXTO, empresaId: 'e-1' }))
  })

  it('si falla la actividad solo ese bloque muestra el error con reintento', async () => {
    mocks.actividad.mockRejectedValueOnce(new Error('falló'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    abrir()
    expect(await screen.findByRole('list', { name: 'Resumen por tienda' })).toBeInTheDocument()
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('No pudimos cargar este dato')
    mocks.actividad.mockResolvedValue(EVENTOS)
    alerta.querySelector('button')!.click()
    expect(await screen.findByRole('list', { name: 'Actividad reciente' })).toBeInTheDocument()
    expect(screen.getAllByRole('list', { name: 'Resumen por tienda' })).toHaveLength(1)
  })

  it.each([320, 768, 1440])('sin violaciones de axe a %i px', async (ancho) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: ancho })
    const { container } = abrir()
    await screen.findByRole('list', { name: 'Actividad reciente' })
    expect(await violacionesAxe(container)).toEqual([])
  })
})
