import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useCategorias: vi.fn(),
  rpc: vi.fn(),
  consulta: vi.fn(),
  llamadas: [] as Array<[string, ...unknown[]]>,
  firmar: vi.fn(),
  useNivelSeccion: vi.fn(),
  useFiltro: vi.fn(),
  elegirEmpresa: vi.fn(),
  costos: vi.fn(),
  esAdmin: vi.fn(),
  precios: vi.fn(),
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
      schema: (esquema: string) => ({
        from: (tabla: string) => {
          mocks.llamadas.push(['schema', esquema], ['from', tabla])
          return { select: () => ({ in: (_columna: string, ids: string[]) => { mocks.llamadas.push(['in', ids]); return { returns: mocks.costos } } }) }
        },
      }),
      from: (vista: string) => {
        mocks.llamadas.push(['from', vista])
        if (vista === 'productos_precio_costo') return { select: () => ({ in: () => ({ returns: mocks.precios }) }) }
        return cadena
      },
      storage: { from: () => ({ createSignedUrls: mocks.firmar }) },
    },
  }
})
vi.mock('../../hooks/useEsAdministrador', () => ({ useEsAdministrador: () => ({ esAdministrador: mocks.esAdmin(), isLoading: false }) }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/useCategorias', () => ({ useCategorias: mocks.useCategorias }))
vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: mocks.useFiltro }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { ProductoList } from './list'

const FILAS = [
  { id: 'p-1', nombre: 'Joystick', sku: 'JOY-1', activo: true, imagen_ruta: 'o/p-1/frente.png', empresa_ids: ['emp-1'], categoria_id: 'cat-1', categoria_ruta: 'Joysticks > Cableados', disponibilidad: 'stock' },
  { id: 'p-2', nombre: 'Cable', sku: null, activo: false, imagen_ruta: null, empresa_ids: [], categoria_id: null, categoria_ruta: null, disponibilidad: 'a_pedido' },
]

const niveles = (productos: string, rentabilidad: string) =>
  mocks.useNivelSeccion.mockImplementation((seccion: string) => ({
    nivel: seccion === 'rentabilidad' ? rentabilidad : productos,
    isLoading: false,
  }))

const abrir = () => render(<MemoryRouter><ProductoList /></MemoryRouter>)

const abrirConDestino = () =>
  render(
    <MemoryRouter initialEntries={['/productos']}>
      <Routes>
        <Route path="/productos" element={<ProductoList />} />
        <Route path="/productos/create" element={<LugarActual />} />
      </Routes>
    </MemoryRouter>,
  )

function LugarActual() {
  const lugar = useLocation()
  return <p>Destino {lugar.pathname}{lugar.search}</p>
}

describe('ProductoList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.esAdmin.mockReturnValue(false)
    mocks.useCategorias.mockReturnValue({ categorias: [], isLoading: false, isError: false, refetch: vi.fn() })
    mocks.llamadas.length = 0
    mocks.firmar.mockResolvedValue({ data: [{ path: 'o/p-1/frente.png', signedUrl: 'https://firmada/p-1.png' }], error: null })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    niveles('edicion', 'ninguno')
    mocks.costos.mockResolvedValue({ data: [{ producto_id: 'p-1', costo: '12.5' }], error: null })
    mocks.precios.mockResolvedValue({
      data: [
        { producto_id: 'p-1', moneda: 'USD', precio_lista: '100', precio_central_ars: '157000' },
        { producto_id: 'p-2', moneda: 'ARS', precio_lista: '2500.5', precio_central_ars: '2500.5' },
      ],
      error: null,
    })
    mocks.consulta.mockResolvedValue({ data: FILAS, error: null, count: 2 })
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    mocks.useFiltro.mockReturnValue({
      empresas: [{ id: 'emp-1', nombre: 'San Javucho' }, { id: 'emp-2', nombre: 'Mundo JC' }],
      valor: null, cambiar: mocks.elegirEmpresa, cargando: false, hayError: false,
    })
  })

  it('Duplicar solo con edición: navega a ?duplicar_de=<id> (FR-009)', async () => {
    abrirConDestino()
    fireEvent.click(await screen.findByRole('button', { name: 'Duplicar Joystick' }))
    expect(await screen.findByText('Destino /productos/create?duplicar_de=p-1')).toBeInTheDocument()
  })

  it('Duplicar no aparece sin edición (FR-009)', async () => {
    niveles('lectura', 'ninguno')
    abrir()
    await screen.findByText('Joystick')
    expect(screen.queryByRole('button', { name: /^Duplicar/ })).not.toBeInTheDocument()
  })

  it('«Importar CSV» solo aparece para el Administrador y lleva a /productos/carga (FR-101)', async () => {
    mocks.esAdmin.mockReturnValue(true)
    abrir()
    expect((await screen.findByRole('link', { name: 'Importar CSV' })).getAttribute('href')).toBe('/productos/carga')
  })

  it('«Importar CSV» no aparece para quien no es Administrador (FR-101)', async () => {
    abrir()
    await screen.findByText('Joystick')
    expect(screen.queryByRole('link', { name: 'Importar CSV' })).toBeNull()
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
    for (const encabezado of ['Producto', 'Precio', 'Margen', 'Stock', 'Categoría', 'Estado']) {
      expect(within(tabla).getByRole('columnheader', { name: new RegExp(encabezado) })).toBeInTheDocument()
    }
    const filaCable = within(tabla).getByText('Cable').closest('tr') as HTMLElement
    // Margen, el SKU vacío y la categoría vacía de Cable (Stock ya muestra la disponibilidad).
    expect(within(filaCable).getAllByText('—')).toHaveLength(3)
  })

  it('Precio siempre en pesos: ARS tal cual y USD convertido con la última cotización y el USD entre paréntesis', async () => {
    abrir()
    await screen.findByText('Joystick')
    const tabla = screen.getByRole('table', { name: 'Productos' })
    const filaJoystick = within(tabla).getByText('Joystick').closest('tr') as HTMLElement
    const filaCable = within(tabla).getByText('Cable').closest('tr') as HTMLElement
    expect(within(filaJoystick).getByText('$ 157.000,00 (USD 100,00)')).toBeInTheDocument()
    expect(within(filaCable).getByText('$ 2.500,50')).toBeInTheDocument()
  })

  it('producto en USD sin cotización muestra el USD y lo aclara; si falla la consulta de precios avisa', async () => {
    mocks.precios.mockResolvedValueOnce({ data: [{ producto_id: 'p-1', moneda: 'USD', precio_lista: '100', precio_central_ars: null }], error: null })
    abrir()
    expect(await screen.findByText('USD 100,00 (sin cotización)')).toBeInTheDocument()
  })

  it('si falla la consulta de precios el listado se muestra igual con «—» y un aviso', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.precios.mockResolvedValue({ data: null, error: { message: 'boom' } })
    abrir()
    expect(await screen.findByText(/No pudimos cargar los precios/)).toBeInTheDocument()
    expect(screen.getByText('Joystick')).toBeInTheDocument()
  })

  it('sin acceso a Rentabilidad no muestra la columna Costo ni consulta producto_costos (F-CAT-16, FR-002)', async () => {
    abrir()
    await screen.findByText('Joystick')
    const tabla = screen.getByRole('table', { name: 'Productos' })
    expect(within(tabla).queryByRole('columnheader', { name: /Costo/ })).not.toBeInTheDocument()
    expect(mocks.costos).not.toHaveBeenCalled()
    expect(mocks.llamadas).not.toContainEqual(['from', 'producto_costos'])
  })

  it.each(['lectura', 'edicion'])('con %s en Rentabilidad la columna Costo muestra el costo de la página (F-CAT-16, FR-002)', async (nivel) => {
    niveles('lectura', nivel)
    abrir()
    await screen.findByText('Joystick')
    const tabla = screen.getByRole('table', { name: 'Productos' })
    expect(within(tabla).getByRole('columnheader', { name: /Costo/ })).toBeInTheDocument()
    expect(mocks.llamadas).toContainEqual(['schema', 'dominio'])
    expect(mocks.llamadas).toContainEqual(['from', 'producto_costos'])
    expect(mocks.llamadas).toContainEqual(['in', ['p-1', 'p-2']])
    const filaJoystick = within(tabla).getByText('Joystick').closest('tr') as HTMLElement
    expect(within(filaJoystick).getByText('12,50')).toBeInTheDocument()
    // Cable no tiene costo cargado: «—», no 0.
    const filaCable = within(tabla).getByText('Cable').closest('tr') as HTMLElement
    expect(within(filaCable).getAllByText('—')).toHaveLength(4)
  })

  it('si falla la consulta de costos el listado se muestra igual con «—» (F-CAT-16)', async () => {
    niveles('lectura', 'lectura')
    mocks.costos.mockResolvedValue({ data: null, error: { message: 'boom' } })
    abrir()
    expect(await screen.findByText('Joystick')).toBeInTheDocument()
    expect(screen.queryByText('No pudimos cargar los productos.')).not.toBeInTheDocument()
    expect(screen.queryByText('12,50')).not.toBeInTheDocument()
    expect(screen.getByText(/No pudimos cargar los costos/)).toBeInTheDocument()
  })

  it('muestra la categoría del producto como «Padre > Hija» (F-CAT-08, FR-022)', async () => {
    abrir()
    await screen.findByText('Joystick')
    const tabla = screen.getByRole('table', { name: 'Productos' })
    const filaJoystick = within(tabla).getByText('Joystick').closest('tr') as HTMLElement
    expect(within(filaJoystick).getByText('Joysticks > Cableados')).toBeInTheDocument()
  })

  it('el filtro de categoría se resuelve en el servidor (raíz incluye subcategorías) y vuelve a la página 1', async () => {
    mocks.useCategorias.mockReturnValue({
      categorias: [
        { id: 'cat-0', nombre: 'Joysticks', padre_id: null, posicion: 0, empresa_ids: [] },
        { id: 'cat-1', nombre: 'Cableados', padre_id: 'cat-0', posicion: 0, empresa_ids: [] },
      ],
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    abrir()
    await screen.findByText('Joystick')
    mocks.llamadas.length = 0
    fireEvent.change(screen.getByLabelText('Categoría'), { target: { value: 'cat-0' } })
    await waitFor(() => expect(mocks.llamadas).toContainEqual(['contains', 'categoria_ids', ['cat-0']]))
    expect(mocks.llamadas).toContainEqual(['range', 0, 24])
    expect(screen.getByRole('button', { name: 'Limpiar filtros' })).toBeInTheDocument()
  })

  it('si la categoría filtrada deja de existir, la consulta vuelve a pedir sin filtrarla', async () => {
    const conCategoria = {
      categorias: [{ id: 'cat-0', nombre: 'Joysticks', padre_id: null, posicion: 0, empresa_ids: [] }],
      isLoading: false, isError: false, refetch: vi.fn(),
    }
    mocks.useCategorias.mockReturnValue(conCategoria)
    const { rerender } = abrir()
    await screen.findByText('Joystick')
    fireEvent.change(screen.getByLabelText('Categoría'), { target: { value: 'cat-0' } })
    await waitFor(() => expect(mocks.llamadas).toContainEqual(['contains', 'categoria_ids', ['cat-0']]))
    mocks.llamadas.length = 0
    mocks.useCategorias.mockReturnValue({ ...conCategoria, categorias: [] })
    rerender(<MemoryRouter><ProductoList /></MemoryRouter>)
    await waitFor(() => expect(mocks.llamadas).toContainEqual(['range', 0, 24]))
    expect(mocks.llamadas.some((l) => l[0] === 'contains' && l[1] === 'categoria_ids')).toBe(false)
  })

  it('sin categorías cargadas no ofrece el filtro de categoría', async () => {
    abrir()
    await screen.findByText('Joystick')
    expect(screen.queryByLabelText('Categoría')).toBeNull()
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
    fireEvent.change(screen.getByLabelText('Buscar por nombre, SKU o código de barras'), { target: { value: '100%' } })
    await waitFor(() => expect(mocks.llamadas).toContainEqual(['or', 'nombre_norm.ilike.%100\\%%,sku.ilike.%100\\%%']))
  })

  it('13 dígitos + Enter consulta el código de barras exacto al instante y el campo conserva el foco (F-CAT-14)', async () => {
    abrir()
    await screen.findByText('Joystick')
    const campo = screen.getByLabelText('Buscar por nombre, SKU o código de barras')
    campo.focus()
    mocks.llamadas.length = 0
    fireEvent.change(campo, { target: { value: '7790001000015' } })
    fireEvent.keyDown(campo, { key: 'Enter' })
    await waitFor(() => expect(mocks.llamadas).toContainEqual(['or', 'codigo_barras.eq.7790001000015,sku.ilike.7790001000015']))
    expect(mocks.llamadas.some(([, f]) => typeof f === 'string' && f.includes('nombre_norm'))).toBe(false)
    expect(screen.getByLabelText('Buscar por nombre, SKU o código de barras')).toBe(campo)
    expect(campo).toHaveFocus()
  })

  it('un código inexistente muestra «No hay productos que coincidan»', async () => {
    abrir()
    await screen.findByText('Joystick')
    mocks.consulta.mockResolvedValue({ data: [], error: null, count: 0 })
    const campo = screen.getByLabelText('Buscar por nombre, SKU o código de barras')
    fireEvent.change(campo, { target: { value: '0000000000000' } })
    fireEvent.keyDown(campo, { key: 'Enter' })
    expect(await screen.findByText('No hay productos que coincidan')).toBeInTheDocument()
    expect(campo).toBeInTheDocument()
  })

  it('texto libre + Enter sigue buscando por nombre/SKU', async () => {
    abrir()
    await screen.findByText('Joystick')
    const campo = screen.getByLabelText('Buscar por nombre, SKU o código de barras')
    fireEvent.change(campo, { target: { value: 'joy' } })
    fireEvent.keyDown(campo, { key: 'Enter' })
    await waitFor(() => expect(mocks.llamadas).toContainEqual(['or', 'nombre_norm.ilike.%joy%,sku.ilike.%joy%']))
  })

  const FILAS_2 = [
    { id: 'p-3', nombre: 'Teclado', sku: 'TEC-1', activo: true, imagen_ruta: null, empresa_ids: [], categoria_id: null, categoria_ruta: null, disponibilidad: 'stock' },
  ]

  it('«Cargar más» pide la tanda siguiente y la suma a lo ya mostrado (carga infinita)', async () => {
    mocks.consulta.mockResolvedValueOnce({ data: FILAS, error: null, count: 3 }).mockResolvedValueOnce({ data: FILAS_2, error: null, count: 3 })
    abrir()
    await screen.findByText('Joystick')
    expect(screen.queryByRole('button', { name: /next page|siguiente/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
    await waitFor(() => expect(mocks.llamadas).toContainEqual(['range', 25, 49]))
    expect(await screen.findByText('Teclado')).toBeInTheDocument()
    expect(screen.getByText('Joystick')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument()
    expect(screen.getByText('No hay más resultados.')).toBeInTheDocument()
  })

  it('buscar después de cargar más reinicia la lista desde el principio: range(0, 24)', async () => {
    mocks.consulta.mockResolvedValueOnce({ data: FILAS, error: null, count: 60 }).mockResolvedValueOnce({ data: FILAS_2, error: null, count: 60 })
    abrir()
    await screen.findByText('Joystick')
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
    await waitFor(() => expect(mocks.llamadas).toContainEqual(['range', 25, 49]))
    mocks.llamadas.length = 0
    mocks.consulta.mockResolvedValue({ data: FILAS_2, error: null, count: 1 })
    fireEvent.change(screen.getByLabelText('Buscar por nombre, SKU o código de barras'), { target: { value: 'tec' } })
    await waitFor(() => expect(mocks.llamadas).toContainEqual(['or', 'nombre_norm.ilike.%tec%,sku.ilike.%tec%']))
    expect(mocks.llamadas).toContainEqual(['range', 0, 24])
    expect(mocks.llamadas).not.toContainEqual(['range', 25, 49])
    await waitFor(() => expect(screen.queryByText('Joystick')).not.toBeInTheDocument())
  })

  it('si falla una tanda siguiente mantiene lo ya cargado y ofrece reintentar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.consulta.mockResolvedValueOnce({ data: FILAS, error: null, count: 60 }).mockResolvedValueOnce({ data: null, error: { message: 'boom' }, count: null })
    abrir()
    await screen.findByText('Joystick')
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
    expect(await screen.findByText('No pudimos cargar más resultados.')).toBeInTheDocument()
    expect(screen.getByText('Joystick')).toBeInTheDocument()
    mocks.consulta.mockResolvedValueOnce({ data: FILAS_2, error: null, count: 60 })
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Teclado')).toBeInTheDocument()
    expect(screen.getByText('Joystick')).toBeInTheDocument()
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

  it('Stock bajo y Sin vincular a ML se ven deshabilitados con su explicación', async () => {
    abrir()
    await screen.findByText('Joystick')
    for (const nombre of [/^Stock bajo/, /^Sin vincular a ML/]) {
      expect(screen.getByRole('button', { name: nombre })).toHaveAttribute('aria-disabled', 'true')
    }
    expect(screen.getByRole('button', { name: /^Stock bajo\. Disponible cuando llegue el módulo de Stock\./ })).toBeInTheDocument()
  })

  it('la columna Stock muestra la etiqueta de disponibilidad de cada producto (F-CAT-17, FR-009)', async () => {
    abrir()
    await screen.findByText('Joystick')
    const tabla = screen.getByRole('table', { name: 'Productos' })
    expect(within(within(tabla).getByText('Joystick').closest('tr') as HTMLElement).getByText('Stock')).toBeInTheDocument()
    expect(within(within(tabla).getByText('Cable').closest('tr') as HTMLElement).getByText('A pedido')).toBeInTheDocument()
  })

  it('el filtro de disponibilidad se resuelve en el servidor, vuelve a la página 1 y «Limpiar filtros» lo quita', async () => {
    abrir()
    await screen.findByText('Joystick')
    const filtro = screen.getByLabelText('Disponibilidad')
    expect(within(filtro).getAllByRole('option').map((o) => o.textContent)).toEqual(['Todos', 'Stock', 'Sin stock', 'A pedido', 'Stock entrante en breve'])
    mocks.llamadas.length = 0
    fireEvent.change(filtro, { target: { value: 'sin_stock' } })
    await waitFor(() => expect(mocks.llamadas).toContainEqual(['eq', 'disponibilidad', 'sin_stock']))
    expect(mocks.llamadas).toContainEqual(['range', 0, 24])
    mocks.llamadas.length = 0
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    await waitFor(() => expect(mocks.llamadas).toContainEqual(['range', 0, 24]))
    expect(mocks.llamadas.some(([m, columna]) => m === 'eq' && columna === 'disponibilidad')).toBe(false)
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

  it('muestra el contador total de productos y no tiene paginación numerada', async () => {
    mocks.consulta.mockResolvedValue({ data: FILAS, error: null, count: 60 })
    abrir()
    await screen.findByText('Joystick')
    expect(screen.getByText('60 productos')).toBeInTheDocument()
    expect(screen.queryByText(/Productos por página/)).not.toBeInTheDocument()
  })

  it('con edición ofrece editar y activar/desactivar, y desactivar llama a la RPC y recarga', async () => {
    abrir()
    await screen.findByText('Joystick')
    expect(screen.getByRole('button', { name: 'Editar Joystick' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Activar Cable' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar Joystick' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('cambiar_estado_producto', { p_id: 'p-1', p_activo: false }))
    await waitFor(() => expect(mocks.consulta).toHaveBeenCalledTimes(2))
  })

  it('con solo lectura no ofrece editar, activar/desactivar ni «Nuevo producto»', async () => {
    niveles('lectura', 'ninguno')
    abrir()
    await screen.findByText('Joystick')
    expect(screen.queryByRole('button', { name: /^(Activar|Desactivar)/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Editar/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nuevo producto' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Actualizar precios' })).not.toBeInTheDocument()
    expect(screen.getByText('Inactivo')).toBeInTheDocument()
  })

  it('con edición ofrece «Actualizar precios» hacia la actualización masiva (F-PRE-10, FR-001)', async () => {
    abrir()
    await screen.findByText('Joystick')
    expect(screen.getByRole('link', { name: 'Actualizar precios' })).toHaveAttribute('href', '/productos/precios-masivos')
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

  describe('edición masiva (F-CAT-12)', () => {
    const CATEGORIAS = [
      { id: 'cat-0', nombre: 'Joysticks', padre_id: null, posicion: 0, empresa_ids: [] },
      { id: 'cat-1', nombre: 'Cableados', padre_id: 'cat-0', posicion: 0, empresa_ids: [] },
    ]
    const marcarTodos = async () => {
      const vista = abrir()
      await screen.findByText('Joystick')
      fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos' }))
      return vista
    }

    it('casillas solo con edición: con lectura no hay casillas y «Seleccionar todos» marca las filas visibles', async () => {
      niveles('lectura', 'ninguno')
      abrir()
      await screen.findByText('Joystick')
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
      expect(screen.queryByText(/seleccionados/)).not.toBeInTheDocument()
      cleanup()
      niveles('edicion', 'ninguno')
      await marcarTodos()
      const casillas = screen.getAllByRole('checkbox', { name: 'Seleccionar producto' })
      expect(casillas).toHaveLength(2)
      for (const casilla of casillas) expect(casilla).toBeChecked()
      fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos' }))
      for (const casilla of screen.getAllByRole('checkbox', { name: 'Seleccionar producto' })) expect(casilla).not.toBeChecked()
    })

    it('barra de selección: «N seleccionados» con las cuatro acciones y ninguna otra', async () => {
      abrir()
      await screen.findByText('Joystick')
      expect(screen.queryByText(/seleccionados/)).not.toBeInTheDocument()
      fireEvent.click(screen.getAllByRole('checkbox', { name: 'Seleccionar producto' })[0])
      const barra = screen.getByRole('region', { name: 'Acciones sobre los productos seleccionados' })
      expect(within(barra).getByText('1 seleccionados')).toBeInTheDocument()
      expect(within(barra).getAllByRole('button').map((boton) => boton.textContent)).toEqual([
        'Mover de categoría', 'Cambiar estado', 'Cambiar empresas', 'Quitar selección',
      ])
      for (const fuera of ['Marcar destacado', 'Enviar al newsletter', 'Borrar']) {
        expect(screen.queryByRole('button', { name: fuera })).not.toBeInTheDocument()
      }
      fireEvent.click(within(barra).getByRole('button', { name: 'Quitar selección' }))
      expect(screen.queryByText(/seleccionados/)).not.toBeInTheDocument()
    })

    it('«Mover de categoría»: texto, árbol con sangría, llamada a la RPC y aviso', async () => {
      mocks.useCategorias.mockReturnValue({ categorias: CATEGORIAS, isLoading: false, isError: false, refetch: vi.fn() })
      mocks.rpc.mockResolvedValue({ data: 2, error: null })
      await marcarTodos()
      fireEvent.click(screen.getByRole('button', { name: 'Mover de categoría' }))
      const dialogo = await screen.findByRole('dialog', { name: 'Mover de categoría' })
      expect(within(dialogo).getByText('Se mueven 2 productos a la categoría elegida.')).toBeInTheDocument()
      const opciones = within(dialogo).getAllByRole('button').filter((boton) => ['Joysticks', 'Cableados'].includes(boton.textContent ?? ''))
      expect(opciones).toHaveLength(2)
      expect(opciones[1].className).not.toEqual(opciones[0].className)
      fireEvent.click(within(dialogo).getByRole('button', { name: 'Cableados' }))
      await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('mover_productos_categoria', { p_producto_ids: ['p-1', 'p-2'], p_categoria_id: 'cat-1' }))
      expect(await screen.findByText('2 productos movidos a Joysticks > Cableados')).toBeInTheDocument()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.queryByText(/seleccionados/)).not.toBeInTheDocument()
      await waitFor(() => expect(mocks.consulta).toHaveBeenCalledTimes(2))
    })

    it('«Cambiar estado»: confirmar queda deshabilitado hasta elegir y avisa activados/desactivados', async () => {
      mocks.rpc.mockResolvedValue({ data: 2, error: null })
      await marcarTodos()
      fireEvent.click(screen.getByRole('button', { name: 'Cambiar estado' }))
      const dialogo = await screen.findByRole('dialog', { name: 'Cambiar estado' })
      expect(within(dialogo).getByRole('button', { name: 'Confirmar' })).toBeDisabled()
      fireEvent.click(within(dialogo).getByRole('radio', { name: 'Desactivar' }))
      fireEvent.click(within(dialogo).getByRole('button', { name: 'Desactivar 2 productos' }))
      await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('cambiar_estado_productos', { p_producto_ids: ['p-1', 'p-2'], p_activo: false }))
      expect(await screen.findByText('2 productos desactivados')).toBeInTheDocument()
    })

    it('«Cambiar empresas»: usa casillas de empresa para agregar y quitar y avisa «N productos actualizados»', async () => {
      mocks.rpc.mockResolvedValue({ data: 2, error: null })
      await marcarTodos()
      fireEvent.click(screen.getByRole('button', { name: 'Cambiar empresas' }))
      const dialogo = await screen.findByRole('dialog', { name: 'Cambiar empresas' })
      const agregar = within(dialogo).getByRole('group', { name: 'Agregar a' })
      const quitar = within(dialogo).getByRole('group', { name: 'Quitar de' })
      expect(within(dialogo).getByRole('button', { name: 'Aplicar a 2 productos' })).toBeDisabled()
      fireEvent.click(within(agregar).getByRole('checkbox', { name: 'Mundo JC' }))
      fireEvent.click(within(quitar).getByRole('checkbox', { name: 'San Javucho' }))
      fireEvent.click(within(dialogo).getByRole('button', { name: 'Aplicar a 2 productos' }))
      await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('definir_empresas_productos', {
        p_producto_ids: ['p-1', 'p-2'], p_agregar: ['emp-2'], p_quitar: ['emp-1'],
      }))
      expect(await screen.findByText('2 productos actualizados')).toBeInTheDocument()
    })

    it('«Cambiar empresas»: una empresa en ambas listas bloquea la confirmación', async () => {
      await marcarTodos()
      fireEvent.click(screen.getByRole('button', { name: 'Cambiar empresas' }))
      const dialogo = await screen.findByRole('dialog', { name: 'Cambiar empresas' })
      fireEvent.click(within(within(dialogo).getByRole('group', { name: 'Agregar a' })).getByRole('checkbox', { name: 'Mundo JC' }))
      fireEvent.click(within(within(dialogo).getByRole('group', { name: 'Quitar de' })).getByRole('checkbox', { name: 'Mundo JC' }))
      expect(within(dialogo).getByText(/no puede estar a la vez/)).toBeInTheDocument()
      expect(within(dialogo).getByRole('button', { name: 'Aplicar a 2 productos' })).toBeDisabled()
    })

    it('si ningún producto cambió el aviso es «No hubo cambios»', async () => {
      mocks.rpc.mockResolvedValue({ data: 0, error: null })
      await marcarTodos()
      fireEvent.click(screen.getByRole('button', { name: 'Cambiar estado' }))
      const dialogo = await screen.findByRole('dialog', { name: 'Cambiar estado' })
      fireEvent.click(within(dialogo).getByRole('radio', { name: 'Activar' }))
      fireEvent.click(within(dialogo).getByRole('button', { name: 'Activar 2 productos' }))
      expect(await screen.findByText('No hubo cambios')).toBeInTheDocument()
    })

    it('estados del diálogo: confirmar deshabilitado mientras corre; el error es claro y deja la selección intacta', async () => {
      let rechazar: (valor: unknown) => void = () => undefined
      mocks.rpc.mockReturnValue(new Promise((resolver) => { rechazar = resolver }))
      await marcarTodos()
      fireEvent.click(screen.getByRole('button', { name: 'Cambiar estado' }))
      const dialogo = await screen.findByRole('dialog', { name: 'Cambiar estado' })
      fireEvent.click(within(dialogo).getByRole('radio', { name: 'Desactivar' }))
      const confirmar = within(dialogo).getByRole('button', { name: 'Desactivar 2 productos' })
      fireEvent.click(confirmar)
      await waitFor(() => expect(confirmar).toBeDisabled())
      expect(within(dialogo).getByRole('button', { name: 'Cancelar' })).toBeDisabled()
      rechazar({ data: null, error: { code: 'P0002', message: 'raw db error' } })
      expect(await within(dialogo).findByText(/ya no existe/)).toBeInTheDocument()
      expect(screen.queryByText(/raw db error/)).not.toBeInTheDocument()
      expect(within(dialogo).getByRole('button', { name: 'Desactivar 2 productos' })).toBeEnabled()
      // La selección sigue intacta detrás del diálogo.
      fireEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(screen.getByText('2 seleccionados')).toBeInTheDocument()
    })

    it('teclado: Escape cierra el diálogo y el foco vuelve al botón que lo abrió', async () => {
      await marcarTodos()
      const origen = screen.getByRole('button', { name: 'Cambiar estado' })
      origen.focus()
      fireEvent.click(origen)
      const dialogo = await screen.findByRole('dialog', { name: 'Cambiar estado' })
      fireEvent.keyDown(dialogo, { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      await waitFor(() => expect(origen).toHaveFocus())
    })

    it('cambio de empresa descarta la selección y cierra el diálogo con aviso (Principio VIII)', async () => {
      const vista = await marcarTodos()
      fireEvent.click(screen.getByRole('button', { name: 'Cambiar estado' }))
      await screen.findByRole('dialog', { name: 'Cambiar estado' })
      mocks.useFiltro.mockReturnValue({
        empresas: [{ id: 'emp-1', nombre: 'San Javucho' }, { id: 'emp-2', nombre: 'Mundo JC' }],
        valor: 'emp-2', cambiar: mocks.elegirEmpresa, cargando: false, hayError: false,
      })
      vista.rerender(<MemoryRouter><ProductoList /></MemoryRouter>)
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(screen.getByText(/Cerramos el cambio masivo/)).toBeInTheDocument()
      expect(screen.queryByText(/seleccionados/)).not.toBeInTheDocument()
      expect(mocks.rpc.mock.calls.map((llamada) => llamada[0])).not.toEqual(expect.arrayContaining(['cambiar_estado_productos']))
      await waitFor(() => expect(mocks.llamadas).toContainEqual(['contains', 'empresa_ids', ['emp-2']]))
    })

    it('cargar más no descarta la selección; cambiar filtro o búsqueda sí', async () => {
      mocks.consulta.mockResolvedValue({ data: FILAS, error: null, count: 60 })
      await marcarTodos()
      expect(screen.getByText('2 seleccionados')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /cargar más/i }))
      await waitFor(() => expect(mocks.llamadas).toContainEqual(expect.arrayContaining(['range'])))
      expect(screen.getByText('2 seleccionados')).toBeInTheDocument()
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'joy' } })
      await waitFor(() => expect(screen.queryByText(/seleccionados/)).not.toBeInTheDocument())
    })

    it.each([[320, true], [768, false], [1440, false]])('a %i px la casilla, la barra y el diálogo siguen disponibles', async (_ancho, angosta) => {
      const original = window.matchMedia
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: angosta, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia
      try {
        abrir()
        await screen.findByText('Joystick')
        fireEvent.click(screen.getAllByRole('checkbox', { name: 'Seleccionar producto' })[0])
        fireEvent.click(screen.getByRole('button', { name: 'Cambiar estado' }))
        expect(await screen.findByRole('dialog', { name: 'Cambiar estado' })).toBeInTheDocument()
      } finally {
        window.matchMedia = original
      }
    })
  })
})
