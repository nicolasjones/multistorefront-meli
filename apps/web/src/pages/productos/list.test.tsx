import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  consulta: vi.fn(),
  llamadas: [] as Array<[string, ...unknown[]]>,
  firmar: vi.fn(),
  useNivelSeccion: vi.fn(),
  useFiltro: vi.fn(),
  elegirEmpresa: vi.fn(),
}))

vi.mock('../../lib/supabase', () => {
  const cadena: Record<string, unknown> = {}
  for (const metodo of ['select', 'eq', 'or', 'contains', 'order', 'range']) {
    cadena[metodo] = (...args: unknown[]) => { mocks.llamadas.push([metodo, ...args]); return cadena }
  }
  cadena.returns = () => mocks.consulta()
  return {
    supabaseClient: {
      rpc: mocks.rpc,
      from: (vista: string) => { mocks.llamadas.push(['from', vista]); return cadena },
      storage: { from: () => ({ createSignedUrls: mocks.firmar }) },
    },
  }
})
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: mocks.useFiltro }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { ProductoList } from './list'

const FILAS = [
  { id: 'p-1', nombre: 'Joystick', sku: 'JOY-1', activo: true, imagen_ruta: 'o/p-1/frente.png', empresa_ids: ['emp-1'] },
  { id: 'p-2', nombre: 'Cable', sku: null, activo: false, imagen_ruta: null, empresa_ids: [] },
]

const abrir = () => render(<MemoryRouter><ProductoList /></MemoryRouter>)

describe('ProductoList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.llamadas.length = 0
    mocks.firmar.mockResolvedValue({ data: [{ path: 'o/p-1/frente.png', signedUrl: 'https://firmada/p-1.png' }], error: null })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.consulta.mockResolvedValue({ data: FILAS, error: null, count: 2 })
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    mocks.useFiltro.mockReturnValue({
      empresas: [{ id: 'emp-1', nombre: 'San Javucho' }, { id: 'emp-2', nombre: 'Mundo JC' }],
      valor: null, cambiar: mocks.elegirEmpresa, cargando: false, hayError: false,
    })
  })

  it('muestra nombre, SKU y la etiqueta «Inactivo» del producto desactivado', async () => {
    abrir()
    expect(await screen.findByText('Joystick')).toBeInTheDocument()
    expect(screen.getByText('JOY-1')).toBeInTheDocument()
    expect(screen.getByText('Activo')).toBeInTheDocument()
    expect(screen.getByText('Inactivo')).toBeInTheDocument()
  })

  it('muestra las columnas del prototipo con «—» donde todavía no hay dato', async () => {
    abrir()
    await screen.findByText('Joystick')
    const tabla = screen.getByRole('table', { name: 'Productos' })
    for (const encabezado of ['Producto', 'Precio', 'Costo', 'Margen', 'Stock', 'Estado']) {
      expect(within(tabla).getByRole('columnheader', { name: new RegExp(encabezado) })).toBeInTheDocument()
    }
    const filaCable = within(tabla).getByText('Cable').closest('tr') as HTMLElement
    // Precio, Costo, Margen, Stock y el SKU vacío de Cable.
    expect(within(filaCable).getAllByText('—')).toHaveLength(5)
  })

  it('consulta la vista del listado, firma la imagen principal y la muestra', async () => {
    abrir()
    await screen.findByText('Joystick')
    expect(mocks.llamadas[0]).toEqual(['from', 'v_productos_listado'])
    expect(mocks.llamadas).toContainEqual(['range', 0, 24])
    expect(mocks.firmar).toHaveBeenCalledWith(['o/p-1/frente.png'], expect.any(Number))
    expect(document.querySelector('img[src="https://firmada/p-1.png"]')).not.toBeNull()
  })

  it('buscar llama al servidor con el texto (tras la espera) y vuelve a la página 1', async () => {
    abrir()
    await screen.findByText('Joystick')
    fireEvent.change(screen.getByLabelText('Buscar por nombre o SKU'), { target: { value: '100%' } })
    await waitFor(() => expect(mocks.llamadas).toContainEqual(['or', 'nombre.ilike.%100\\%%,sku.ilike.%100\\%%']))
  })

  it('buscar estando en la página 2 vuelve a pedir range(0, 24)', async () => {
    mocks.consulta.mockResolvedValue({ data: FILAS, error: null, count: 60 })
    abrir()
    await screen.findByText('Joystick')
    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente/i }))
    await waitFor(() => expect(mocks.llamadas).toContainEqual(['range', 25, 49]))
    mocks.llamadas.length = 0
    fireEvent.change(screen.getByLabelText('Buscar por nombre o SKU'), { target: { value: 'joy' } })
    await waitFor(() => expect(mocks.llamadas).toContainEqual(['or', 'nombre.ilike.%joy%,sku.ilike.%joy%']))
    expect(mocks.llamadas).toContainEqual(['range', 0, 24])
    expect(mocks.llamadas).not.toContainEqual(['range', 25, 49])
  })

  it('el filtro Inactivos consulta activo = false y «Limpiar filtros» lo quita', async () => {
    abrir()
    await screen.findByText('Joystick')
    expect(screen.queryByRole('button', { name: 'Limpiar filtros' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Inactivos' }))
    await waitFor(() => expect(mocks.llamadas).toContainEqual(['eq', 'activo', false]))
    mocks.llamadas.length = 0
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    await waitFor(() => expect(mocks.llamadas).toContainEqual(['range', 0, 24]))
    expect(mocks.llamadas.some(([m]) => m === 'eq')).toBe(false)
  })

  it('Sin stock, Stock bajo y Sin vincular a ML se ven deshabilitados con su explicación', async () => {
    abrir()
    await screen.findByText('Joystick')
    for (const nombre of [/^Sin stock/, /^Stock bajo/, /^Sin vincular a ML/]) {
      expect(screen.getByRole('button', { name: nombre })).toHaveAttribute('aria-disabled', 'true')
    }
    expect(screen.getByRole('button', { name: /^Sin stock\. Disponible cuando llegue el módulo de Stock\./ })).toBeInTheDocument()
  })

  it('ordenar por el encabezado pide el orden al servidor, con desempate por id', async () => {
    abrir()
    await screen.findByText('Joystick')
    fireEvent.click(screen.getByRole('button', { name: 'Estado' }))
    await waitFor(() => expect(mocks.llamadas).toContainEqual(['order', 'activo', { ascending: true, nullsFirst: false }]))
    expect(mocks.llamadas).toContainEqual(['order', 'id', { ascending: true }])
    fireEvent.click(screen.getByRole('button', { name: 'Estado' }))
    await waitFor(() => expect(mocks.llamadas).toContainEqual(['order', 'activo', { ascending: false, nullsFirst: true }]))
  })

  it('el selector «Ordenar por» permite ordenar por SKU y cambiar la dirección', async () => {
    abrir()
    await screen.findByText('Joystick')
    fireEvent.change(screen.getByLabelText('Ordenar por'), { target: { value: 'sku' } })
    await waitFor(() => expect(mocks.llamadas).toContainEqual(['order', 'sku', { ascending: true, nullsFirst: false }]))
    fireEvent.click(screen.getByRole('button', { name: /Cambiar a orden descendente/ }))
    await waitFor(() => expect(mocks.llamadas).toContainEqual(['order', 'sku', { ascending: false, nullsFirst: true }]))
    expect(screen.getByRole('button', { name: /Cambiar a orden ascendente/ })).toBeInTheDocument()
  })

  it('con filtros y sin resultados avisa que nada coincide y deja limpiar', async () => {
    abrir()
    await screen.findByText('Joystick')
    mocks.consulta.mockResolvedValue({ data: [], error: null, count: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'Inactivos' }))
    expect(await screen.findByText('No hay productos que coincidan')).toBeInTheDocument()
    expect(screen.getByText('Probá con otra búsqueda o limpiá los filtros.')).toBeInTheDocument()
    mocks.consulta.mockResolvedValue({ data: FILAS, error: null, count: 2 })
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    expect(await screen.findByText('Joystick')).toBeInTheDocument()
  })

  it('muestra el pie «desde–hasta de N»', async () => {
    mocks.consulta.mockResolvedValue({ data: FILAS, error: null, count: 60 })
    abrir()
    await screen.findByText('Joystick')
    expect(screen.getByText('1–25 de 60')).toBeInTheDocument()
  })

  it('con edición ofrece editar y activar/desactivar, y desactivar llama a la RPC y recarga', async () => {
    abrir()
    await screen.findByText('Joystick')
    expect(screen.getByRole('link', { name: 'Editar Joystick' })).toHaveAttribute('href', '/productos/p-1/edit')
    expect(screen.getByRole('button', { name: 'Activar Cable' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar Joystick' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('cambiar_estado_producto', { p_id: 'p-1', p_activo: false }))
    await waitFor(() => expect(mocks.consulta).toHaveBeenCalledTimes(2))
  })

  it('con solo lectura no ofrece editar, activar/desactivar ni «Nuevo producto»', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    abrir()
    await screen.findByText('Joystick')
    expect(screen.queryByRole('button', { name: /^(Activar|Desactivar)/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^Editar/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Nuevo producto' })).not.toBeInTheDocument()
    expect(screen.getByText('Inactivo')).toBeInTheDocument()
  })

  it('un error al cambiar el estado se avisa en castellano, sin texto crudo, y no recarga', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } })
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Desactivar Joystick' }))
    expect(await screen.findByText(/No tenés permiso para esta acción/)).toBeInTheDocument()
    expect(screen.queryByText(/row-level security/)).not.toBeInTheDocument()
    expect(mocks.consulta).toHaveBeenCalledTimes(1)
  })

  it('sin productos muestra el estado vacío', async () => {
    mocks.consulta.mockResolvedValue({ data: [], error: null, count: 0 })
    abrir()
    expect(await screen.findByText('Todavía no hay productos cargados.')).toBeInTheDocument()
  })

  it('ante un error de carga ofrece reintentar', async () => {
    mocks.consulta.mockResolvedValueOnce({ data: null, error: { message: 'boom' }, count: null })
    abrir()
    expect(await screen.findByText('No pudimos cargar los productos.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }))
    expect(await screen.findByText('Joystick')).toBeInTheDocument()
  })

  it('«Visible en» muestra un chip por empresa: relleno si la vende y en contorno si no', async () => {
    abrir()
    await screen.findByText('Joystick')
    const tabla = screen.getByRole('table', { name: 'Productos' })
    expect(within(tabla).getByRole('columnheader', { name: /Visible en/ })).toBeInTheDocument()
    const filaJoystick = within(tabla).getByText('Joystick').closest('tr') as HTMLElement
    const vende = within(filaJoystick).getByLabelText('San Javucho: se vende')
    const noVende = within(filaJoystick).getByLabelText('Mundo JC: no se vende')
    expect(within(filaJoystick).getByRole('img', { name: /San Javucho: se vende/ })).toBe(vende)
    expect(within(filaJoystick).getByRole('img', { name: /Mundo JC: no se vende/ })).toBe(noVende)
    expect(vende.className).toMatch(/MuiChip-filled/)
    expect(noVende.className).toMatch(/MuiChip-outlined/)
    const filaCable = within(tabla).getByText('Cable').closest('tr') as HTMLElement
    expect(within(filaCable).getByLabelText('San Javucho: no se vende').className).toMatch(/MuiChip-outlined/)
  })

  it('el filtro de tienda sigue a la empresa activa y se resuelve en el servidor', async () => {
    mocks.useFiltro.mockReturnValue({
      empresas: [{ id: 'emp-1', nombre: 'San Javucho' }, { id: 'emp-2', nombre: 'Mundo JC' }],
      valor: 'emp-2', cambiar: mocks.elegirEmpresa, cargando: false, hayError: false,
    })
    abrir()
    await screen.findByText('Joystick')
    expect(mocks.llamadas).toContainEqual(['contains', 'empresa_ids', ['emp-2']])
    expect(screen.getByRole('button', { name: 'Mundo JC' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Todas las tiendas' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('elegir una tienda cambia el filtro y «Todas las tiendas» lo quita; sin filtro no pide contains', async () => {
    abrir()
    await screen.findByText('Joystick')
    expect(mocks.llamadas.some(([metodo]) => metodo === 'contains')).toBe(false)
    expect(screen.getByRole('button', { name: 'Todas las tiendas' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Mundo JC' }))
    expect(mocks.elegirEmpresa).toHaveBeenCalledWith('emp-2')
    fireEvent.click(screen.getByRole('button', { name: 'Todas las tiendas' }))
    expect(mocks.elegirEmpresa).toHaveBeenLastCalledWith(null)
  })

  it('con una tienda filtrada y sin resultados avisa que nada coincide (no «catálogo vacío»)', async () => {
    mocks.useFiltro.mockReturnValue({
      empresas: [{ id: 'emp-1', nombre: 'San Javucho' }, { id: 'emp-2', nombre: 'Mundo JC' }],
      valor: 'emp-2', cambiar: mocks.elegirEmpresa, cargando: false, hayError: false,
    })
    mocks.consulta.mockResolvedValue({ data: [], error: null, count: 0 })
    abrir()
    expect(await screen.findByText('No hay productos que coincidan')).toBeInTheDocument()
    expect(screen.queryByText('Todavía no hay productos cargados.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    expect(mocks.elegirEmpresa).toHaveBeenCalledWith(null)
  })

  it('si no se pueden cargar las tiendas lo dice y el listado sigue sin ese filtro', async () => {
    mocks.useFiltro.mockReturnValue({ empresas: [], valor: null, cambiar: mocks.elegirEmpresa, cargando: false, hayError: true })
    abrir()
    expect(await screen.findByText('Joystick')).toBeInTheDocument()
    expect(screen.getByText('No pudimos cargar las tiendas para filtrar.')).toBeInTheDocument()
  })
})
