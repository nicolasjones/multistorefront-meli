import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  leerCategorias: vi.fn(),
  guardarCategoria: vi.fn(),
  reordenarCategorias: vi.fn(),
  eliminarCategoria: vi.fn(),
  useNivelSeccion: vi.fn(),
  useFiltro: vi.fn(),
  useEmpresas: vi.fn(),
  useOrganizacionActiva: vi.fn(),
  elegirEmpresa: vi.fn(),
}))

vi.mock('../../lib/categorias', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/categorias')>()
  return {
    ...actual,
    leerCategorias: mocks.leerCategorias,
    guardarCategoria: mocks.guardarCategoria,
    reordenarCategorias: mocks.reordenarCategorias,
    eliminarCategoria: mocks.eliminarCategoria,
  }
})
vi.mock('../../lib/supabase', () => ({ supabaseClient: {} }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: mocks.useFiltro }))
vi.mock('../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: mocks.useOrganizacionActiva }))
vi.mock('../../hooks/useEmpresas', () => ({ useEmpresas: mocks.useEmpresas }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { CategoriaList } from './list'

const EMPRESAS = [
  { id: 'e1', nombre: 'San Javucho', activa: true },
  { id: 'e2', nombre: 'Mundo JC', activa: true },
]

const CATEGORIAS = [
  { id: 'joy', nombre: 'Joysticks', padre_id: null, posicion: 0, empresa_ids: ['e1', 'e2'] },
  { id: 'cab', nombre: 'Cableados', padre_id: 'joy', posicion: 0, empresa_ids: ['e2'] },
  { id: 'fun', nombre: 'Fundas', padre_id: null, posicion: 1, empresa_ids: ['e1'] },
]

const RESULTADO = { categorias: CATEGORIAS, conteos: new Map([['cab', 2], ['fun', 1]]) }

const abrir = () => render(<MemoryRouter><CategoriaList /></MemoryRouter>)

describe('CategoriaList (F-CAT-08, FR-018…FR-024)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.leerCategorias.mockResolvedValue(RESULTADO)
    mocks.guardarCategoria.mockResolvedValue('nueva')
    mocks.reordenarCategorias.mockResolvedValue(undefined)
    mocks.eliminarCategoria.mockResolvedValue({ productos: 0, subcategorias: 1 })
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.useFiltro.mockReturnValue({
      empresas: EMPRESAS,
      valor: null,
      cambiar: mocks.elegirEmpresa,
      empresaActivaId: null,
      hayError: false,
    })
    mocks.useOrganizacionActiva.mockReturnValue({ organizacionActiva: { id: 'o1' }, isLoading: false })
    mocks.useEmpresas.mockReturnValue({ empresas: EMPRESAS, isLoading: false, isError: false, refetch: vi.fn() })
  })

  it('muestra el árbol con «Expandir todo»/«Contraer todo», conteos y filtro de tienda', async () => {
    abrir()
    expect(await screen.findByText('Joysticks')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Categorías' })).toBeInTheDocument()
    expect(screen.getByText('Cableados')).toBeInTheDocument()
    expect(screen.getByText('Fundas')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nueva categoría' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Todas las tiendas' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expandir todo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Contraer todo' })).toBeInTheDocument()
    const filaCab = screen.getByText('Cableados').closest('li') as HTMLElement
    expect(within(filaCab).getByText('2')).toBeInTheDocument()
  })

  it('Expandir todo y Contraer todo gobiernan las subcategorías', async () => {
    abrir()
    await screen.findByText('Joysticks')
    fireEvent.click(screen.getByRole('button', { name: 'Contraer todo' }))
    expect(screen.queryByText('Cableados')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Expandir todo' }))
    expect(screen.getByText('Cableados')).toBeInTheDocument()
  })

  it('el filtro de tienda sigue la empresa activa y se puede limpiar', async () => {
    mocks.useFiltro.mockReturnValue({
      empresas: EMPRESAS,
      valor: 'e2',
      cambiar: mocks.elegirEmpresa,
      empresaActivaId: 'e2',
      hayError: false,
    })
    abrir()
    await screen.findByText('Joysticks')
    expect(screen.getByText('Cableados')).toBeInTheDocument()
    expect(screen.queryByText('Fundas')).toBeNull()
    expect(screen.getByRole('button', { name: 'San Javucho' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Todas las tiendas' }))
    expect(mocks.elegirEmpresa).toHaveBeenCalledWith(null)
  })

  it('al cambiar de organización (misma empresa) vacía el árbol, cierra diálogos y recarga', async () => {
    const otra = { categorias: [{ id: 'x', nombre: 'Otra org', padre_id: null, posicion: 0, empresa_ids: [] }], conteos: new Map() }
    const { rerender } = abrir()
    await screen.findByText('Joysticks')
    fireEvent.click(screen.getByRole('button', { name: 'Nueva categoría' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    mocks.leerCategorias.mockResolvedValue(otra)
    mocks.useOrganizacionActiva.mockReturnValue({ organizacionActiva: { id: 'o2' }, isLoading: false })
    rerender(<MemoryRouter><CategoriaList /></MemoryRouter>)
    expect(await screen.findByText('Otra org')).toBeInTheDocument()
    expect(screen.queryByText('Joysticks')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mocks.leerCategorias).toHaveBeenCalledTimes(2)
  })

  it('al cambiar de organización y de empresa a la vez muestra solo lo de la nueva y recarga', async () => {
    const otra = { categorias: [{ id: 'y', nombre: 'Org nueva', padre_id: null, posicion: 0, empresa_ids: ['e9'] }], conteos: new Map() }
    const { rerender } = abrir()
    await screen.findByText('Joysticks')
    mocks.leerCategorias.mockResolvedValue(otra)
    mocks.useOrganizacionActiva.mockReturnValue({ organizacionActiva: { id: 'o2' }, isLoading: false })
    mocks.useFiltro.mockReturnValue({ empresas: EMPRESAS, valor: 'e9', cambiar: mocks.elegirEmpresa, empresaActivaId: 'e9', hayError: false })
    rerender(<MemoryRouter><CategoriaList /></MemoryRouter>)
    expect(await screen.findByText('Org nueva')).toBeInTheDocument()
    expect(screen.queryByText('Joysticks')).toBeNull()
    expect(screen.queryByText('Cableados')).toBeNull()
  })

  it('sin categorías muestra el estado vacío con la invitación a crear la primera', async () => {
    mocks.leerCategorias.mockResolvedValue({ categorias: [], conteos: new Map() })
    abrir()
    expect(await screen.findByText('Todavía no hay categorías.')).toBeInTheDocument()
    expect(screen.getByText('Creá la primera con «Nueva categoría».')).toBeInTheDocument()
  })

  it('si falla la carga muestra el error y «Reintentar» vuelve a pedir los datos', async () => {
    mocks.leerCategorias.mockReset()
    mocks.leerCategorias.mockRejectedValueOnce(new Error('red')).mockResolvedValue(RESULTADO)
    abrir()
    expect(await screen.findByText('No pudimos cargar las categorías.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Joysticks')).toBeInTheDocument()
    expect(mocks.leerCategorias).toHaveBeenCalledTimes(2)
  })

  it('crear una categoría la guarda con todas las tiendas marcadas y recarga el árbol', async () => {
    abrir()
    await screen.findByText('Joysticks')
    fireEvent.click(screen.getByRole('button', { name: 'Nueva categoría' }))
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: 'Nueva' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.guardarCategoria).toHaveBeenCalledWith(expect.anything(), { id: null, nombre: 'Nueva', padreId: null, empresaIds: ['e1', 'e2'] }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mocks.leerCategorias).toHaveBeenCalledTimes(2)
  })

  it('agregar una subcategoría desde la fila abre el diálogo con el padre elegido', async () => {
    abrir()
    await screen.findByText('Joysticks')
    fireEvent.click(screen.getByRole('button', { name: 'Agregar subcategoría a Joysticks' }))
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: 'Volantes' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.guardarCategoria).toHaveBeenCalledWith(expect.anything(), { id: null, nombre: 'Volantes', padreId: 'joy', empresaIds: ['e1', 'e2'] }))
  })

  it('editar precarga la categoría y guarda su id', async () => {
    abrir()
    await screen.findByText('Joysticks')
    fireEvent.click(screen.getByRole('button', { name: 'Editar Joysticks' }))
    const nombre = screen.getByLabelText(/^Nombre/)
    expect(nombre).toHaveValue('Joysticks')
    fireEvent.change(nombre, { target: { value: 'Joysticks y más' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.guardarCategoria).toHaveBeenCalledWith(expect.anything(), { id: 'joy', nombre: 'Joysticks y más', padreId: null, empresaIds: ['e1', 'e2'] }))
  })

  it('eliminar muestra el diálogo del prototipo y confirma de forma atómica', async () => {
    abrir()
    await screen.findByText('Joysticks')
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Joysticks' }))
    expect(screen.getByRole('dialog', { name: 'Eliminar categoría' })).toBeInTheDocument()
    expect(screen.getByText(/«Joysticks» tiene 0 productos y 1 subcategoría/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }))
    await waitFor(() => expect(mocks.eliminarCategoria).toHaveBeenCalledWith(expect.anything(), 'joy'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('Subir por teclado persiste el orden completo con reordenar_categorias', async () => {
    abrir()
    await screen.findByText('Fundas')
    fireEvent.click(screen.getByRole('button', { name: 'Subir Fundas' }))
    await waitFor(() => expect(mocks.reordenarCategorias).toHaveBeenCalled())
    const orden = mocks.reordenarCategorias.mock.calls[0][1] as Array<{ id: string; padre_id: string | null; posicion: number }>
    expect(orden).toEqual(expect.arrayContaining([
      { id: 'fun', padre_id: null, posicion: 0 },
      { id: 'joy', padre_id: null, posicion: 1 },
      { id: 'cab', padre_id: 'joy', posicion: 0 },
    ]))
  })

  it('con solo lectura no hay acciones ni «Nueva categoría»', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    abrir()
    await screen.findByText('Joysticks')
    expect(screen.queryByRole('button', { name: 'Nueva categoría' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Editar Joysticks' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Eliminar Joysticks' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Subir Fundas' })).toBeNull()
    expect(screen.getByText('Cableados')).toBeInTheDocument()
  })
})
