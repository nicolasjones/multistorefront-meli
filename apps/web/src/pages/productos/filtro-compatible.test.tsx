// F-CAT-09 (MSF-360, FR-003/004/006/007, SC-002): filtro «Compatible con» y etiquetas del listado de productos.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  consulta: vi.fn(),
  llamadas: [] as Array<[string, ...unknown[]]>,
  useNivelSeccion: vi.fn(),
  useFiltro: vi.fn(),
}))

vi.mock('../../lib/supabase', () => {
  const cadena: Record<string, unknown> = {}
  for (const metodo of ['select', 'eq', 'or', 'contains', 'overlaps', 'order', 'range']) {
    cadena[metodo] = (...args: unknown[]) => { mocks.llamadas.push([metodo, ...args]); return cadena }
  }
  cadena.returns = () => mocks.consulta()
  return {
    supabaseClient: {
      rpc: mocks.rpc,
      from: (vista: string) => { mocks.llamadas.push(['from', vista]); return cadena },
      storage: { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }) }) },
    },
  }
})
vi.mock('../../hooks/useEsAdministrador', () => ({ useEsAdministrador: () => ({ esAdministrador: false, isLoading: false }) }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/useCategorias', () => ({ useCategorias: () => ({ categorias: [], isLoading: false, isError: false, refetch: vi.fn() }) }))
vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: mocks.useFiltro }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { ProductoList } from './list'
import { agruparCompatibles, expandirCompatibles, literalArrayPostgres } from '../../lib/productosListado'

const fila = (id: string, nombre: string, compatible_con: string[] | null) => ({
  id, nombre, sku: null, activo: true, imagen_ruta: null, empresa_ids: [], categoria_id: null, categoria_ruta: null,
  disponibilidad: 'stock', compatible_con,
})
const FILAS = [fila('p-1', 'Joystick', ['PS5', 'Xbox']), fila('p-2', 'Cable', null)]

const empresa = (valor: string | null) => ({
  empresas: [{ id: 'emp-1', nombre: 'San Javucho' }, { id: 'emp-2', nombre: 'Mundo JC' }],
  valor, cambiar: vi.fn(), cargando: false, hayError: false,
})
const abrir = () => render(<MemoryRouter><ProductoList /></MemoryRouter>)
const ultimoOverlaps = () => [...mocks.llamadas].reverse().find((l) => l[0] === 'overlaps')
const elegir = (nombre: string) => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Compatible con' }))
  fireEvent.click(screen.getByRole('option', { name: nombre }))
}

describe('helpers de «Compatible con»', () => {
  it('agrupa sin distinguir mayúsculas y expande a todas las variantes guardadas', () => {
    const grupos = agruparCompatibles(['PS5', 'ps5', 'Xbox', ' '])
    expect(grupos.map((g) => g.clave)).toEqual(['ps5', 'xbox'])
    expect(expandirCompatibles(['ps5'], grupos)).toEqual(['PS5', 'ps5'])
    expect(expandirCompatibles(['inexistente'], grupos)).toEqual([])
  })
  it('escapa comillas, barras, comas y llaves en el literal del array', () => {
    expect(literalArrayPostgres(['PS5', 'a"b', 'c\\d', 'x,y}'])).toBe('{"PS5","a\\"b","c\\\\d","x,y}"}')
  })
})

describe('Filtro «Compatible con» del listado', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.llamadas.length = 0
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.consulta.mockResolvedValue({ data: FILAS, error: null, count: 2 })
    mocks.rpc.mockResolvedValue({ data: ['PS5', 'ps5', 'Xbox'], error: null })
    mocks.useFiltro.mockReturnValue(empresa(null))
  })

  it('FR-004: muestra los valores como etiquetas y no muestra nada si no hay', async () => {
    abrir()
    const tabla = await screen.findByRole('table', { name: 'Productos' })
    const filaJoystick = (await within(tabla).findByText('Joystick')).closest('tr') as HTMLElement
    const lista = within(filaJoystick).getByRole('list', { name: 'Compatible con' })
    expect(within(lista).getAllByRole('listitem').map((e) => e.textContent)).toEqual(['PS5', 'Xbox'])
    const filaCable = within(tabla).getByText('Cable').closest('tr') as HTMLElement
    expect(within(filaCable).queryByRole('list', { name: 'Compatible con' })).toBeNull()
  })

  it('FR-003: ofrece un valor por clave y filtra por alguno, con todas las variantes de mayúsculas', async () => {
    abrir()
    await screen.findByText('Joystick')
    const combo = await screen.findByRole('combobox', { name: 'Compatible con' })
    fireEvent.mouseDown(combo)
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['PS5', 'Xbox'])
    fireEvent.click(screen.getByRole('option', { name: 'PS5' }))
    await waitFor(() => expect(ultimoOverlaps()).toEqual(['overlaps', 'compatible_con', '{"PS5","ps5"}']))
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Compatible con' }))
    fireEvent.click(screen.getByRole('option', { name: 'Xbox' }))
    await waitFor(() => expect(ultimoOverlaps()).toEqual(['overlaps', 'compatible_con', '{"PS5","ps5","Xbox"}']))
  })

  it('FR-003: se combina con la búsqueda y vuelve a la página 1', async () => {
    abrir()
    await screen.findByText('Joystick')
    await screen.findByRole('combobox', { name: 'Compatible con' })
    fireEvent.change(screen.getByLabelText(/Buscar por nombre/), { target: { value: 'joy' } })
    await waitFor(() => expect(mocks.llamadas.some((l) => l[0] === 'or' && String(l[1]).includes('joy'))).toBe(true))
    mocks.llamadas.length = 0
    await screen.findByRole('combobox', { name: 'Compatible con' })
    elegir('Xbox')
    await waitFor(() => expect(ultimoOverlaps()).toEqual(['overlaps', 'compatible_con', '{"Xbox"}']))
    expect(mocks.llamadas.some((l) => l[0] === 'or' && String(l[1]).includes('joy'))).toBe(true)
    expect(mocks.llamadas).toContainEqual(['range', 0, 24])
  })

  it('FR-006: «Limpiar filtros» quita el filtro de compatible', async () => {
    abrir()
    await screen.findByText('Joystick')
    await screen.findByRole('combobox', { name: 'Compatible con' })
    elegir('PS5')
    await waitFor(() => expect(ultimoOverlaps()).toBeDefined())
    mocks.llamadas.length = 0
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    await waitFor(() => expect(mocks.llamadas).toContainEqual(['range', 0, 24]))
    expect(ultimoOverlaps()).toBeUndefined()
    expect(screen.queryByRole('button', { name: 'Limpiar filtros' })).toBeNull()
  })

  it('FR-006: sin resultados usa el estado vacío existente', async () => {
    abrir()
    await screen.findByText('Joystick')
    await screen.findByRole('combobox', { name: 'Compatible con' })
    mocks.consulta.mockResolvedValue({ data: [], error: null, count: 0 })
    elegir('Xbox')
    expect(await screen.findByText('No hay productos que coincidan')).toBeInTheDocument()
  })

  it('sin valores cargados no ofrece el filtro', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    abrir()
    await screen.findByText('Joystick')
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('listar_compatibles'))
    expect(screen.queryByRole('combobox', { name: 'Compatible con' })).toBeNull()
  })

  it('si falla la carga de valores avisa en el filtro y el listado sigue funcionando', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    abrir()
    expect(await screen.findByText('No pudimos cargar los valores.')).toBeInTheDocument()
    expect(screen.getByText('Joystick')).toBeInTheDocument()
  })

  it('FR-007: al cambiar de empresa recarga valores y productos, descarta valores inexistentes y reencuadra la página', async () => {
    const { rerender } = abrir()
    await screen.findByText('Joystick')
    await screen.findByRole('combobox', { name: 'Compatible con' })
    elegir('Xbox')
    await waitFor(() => expect(ultimoOverlaps()).toEqual(['overlaps', 'compatible_con', '{"Xbox"}']))
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    // En la otra empresa «Xbox» ya no existe.
    mocks.rpc.mockResolvedValue({ data: ['Switch'], error: null })
    mocks.llamadas.length = 0
    mocks.useFiltro.mockReturnValue(empresa('emp-2'))
    rerender(<MemoryRouter><ProductoList /></MemoryRouter>)
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2))
    await waitFor(() => {
      // La pantalla también consulta precios y costos después del listado: se busca la última consulta de la VISTA
      // del listado, no el último `from` (que ya no es el de productos).
      const ultimoFrom = mocks.llamadas.map((l) => l[0] === 'from' && l[1] === 'v_productos_listado').lastIndexOf(true)
      expect(ultimoFrom).toBeGreaterThanOrEqual(0)
      const desdeUltima = mocks.llamadas.slice(ultimoFrom)
      expect(desdeUltima.some((l) => l[0] === 'overlaps')).toBe(false)
      expect(desdeUltima).toContainEqual(['contains', 'empresa_ids', ['emp-2']])
    })
    expect(mocks.llamadas).toContainEqual(['range', 0, 24])
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Compatible con' }))
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Switch'])
  })
})
