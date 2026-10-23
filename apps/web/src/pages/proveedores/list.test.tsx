import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'


// Test de INTEGRACIÓN de la pantalla (varios campos + RPC): con la suite shardeada el default de 5 s
// quedaba justo y daba falsos rojos. Se sube el timeout del archivo.
vi.setConfig({ testTimeout: 20000 })

const mocks = vi.hoisted(() => ({
  useListarProveedores: vi.fn(),
  useNivelSeccion: vi.fn(),
  refetch: vi.fn(),
  useEmpresasAccesibles: vi.fn(),
}))

vi.mock('../../hooks/useListarProveedores', () => ({ useListarProveedores: mocks.useListarProveedores }))
vi.mock('../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: mocks.useEmpresasAccesibles }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../components/proveedores/ProveedorFormDialog', () => ({
  ProveedorFormDialog: ({ open, onGuardado }: { open: boolean; onGuardado: (p: unknown) => void }) =>
    open ? <div role="dialog" aria-label="Nuevo proveedor"><button type="button" onClick={() => onGuardado({ id: 'nuevo' })}>Guardar proveedor</button></div> : null,
}))

import type { ProveedorListado } from '../../hooks/useListarProveedores'
import { ProveedorList } from './list'

const proveedor = (n: number, extra: Partial<ProveedorListado> = {}): ProveedorListado => ({
  id: `p-${n}`, razon_social: `Proveedor ${n}`, cuit: '20123456786', correo: null, telefono: null, activo: true, empresas: [], ...extra,
})

const respuesta = (proveedores: ProveedorListado[], extra: Record<string, unknown> = {}) => ({
  proveedores, total: proveedores.length, isLoading: false, isFetching: false, isError: false, refetch: mocks.refetch, ...extra,
})

const ultimosFiltros = () => mocks.useListarProveedores.mock.calls.at(-1)![0]
const abrir = () => render(<MemoryRouter><ProveedorList /></MemoryRouter>)

describe('ProveedorList', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.useEmpresasAccesibles.mockReturnValue({
      empresas: [{ id: 'e-1', nombre: 'San Javucho', esActiva: false }, { id: 'e-2', nombre: 'Mundo JC', esActiva: false }],
      empresaActivaId: null, isLoading: false, isError: false,
    })
    mocks.useListarProveedores.mockReturnValue(respuesta([
      proveedor(1, { correo: 'a@uno.example.com', telefono: '11 5555' }),
      proveedor(2, { cuit: '30701234568', activo: false }),
    ]))
  })
  afterEach(() => vi.useRealTimers())

  it('muestra las columnas Razón social, CUIT, Compra para, Correo y Teléfono con el CUIT con guiones y «Ver ficha»', () => {
    abrir()
    for (const nombre of ['Razón social', 'CUIT', 'Compra para', 'Correo', 'Teléfono']) {
      expect(screen.getByRole('columnheader', { name: nombre })).toBeInTheDocument()
    }
    expect(ultimosFiltros()).toEqual({ texto: '', estado: 'activos', empresaId: null, pagina: 1, tamano: 25 })
    expect(screen.getByText('20-12345678-6')).toBeInTheDocument()
    expect(screen.getByText('a@uno.example.com')).toBeInTheDocument()
    expect(screen.getByText('11 5555')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver ficha de Proveedor 2' })).toHaveAttribute('href', '/proveedores/show/p-2')
    // Sin identificadores técnicos a la vista.
    expect(screen.queryByText('p-1')).not.toBeInTheDocument()
  })

  it('muestra las tiendas «Compra para» como chips y — si no tiene', () => {
    mocks.useListarProveedores.mockReturnValue(respuesta([
      proveedor(1, { empresas: [{ id: 'e-2', nombre: 'Mundo JC' }, { id: 'e-1', nombre: 'San Javucho' }] }),
      proveedor(2),
    ]))
    abrir()
    expect(screen.getByText('Mundo JC', { selector: '.MuiChip-label' })).toBeInTheDocument()
    expect(screen.getByText('San Javucho', { selector: '.MuiChip-label' })).toBeInTheDocument()
  })

  it('el filtro por tienda pide esa tienda al servidor y vuelve a la página 1', () => {
    mocks.useListarProveedores.mockReturnValue(respuesta([proveedor(1)], { total: 60 }))
    abrir()
    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Mundo JC' }))
    expect(ultimosFiltros()).toMatchObject({ empresaId: 'e-2', pagina: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Todas las tiendas' }))
    expect(ultimosFiltros().empresaId).toBeNull()
  })

  it('el filtro de tienda arranca en la empresa activa y la sigue al cambiarla', () => {
    mocks.useEmpresasAccesibles.mockReturnValue({
      empresas: [{ id: 'e-1', nombre: 'San Javucho', esActiva: false }, { id: 'e-2', nombre: 'Mundo JC', esActiva: true }],
      empresaActivaId: 'e-2', isLoading: false, isError: false,
    })
    const { rerender } = abrir()
    expect(ultimosFiltros().empresaId).toBe('e-2')

    // Cambia la empresa activa en la barra superior: la pantalla la sigue.
    mocks.useEmpresasAccesibles.mockReturnValue({
      empresas: [{ id: 'e-1', nombre: 'San Javucho', esActiva: true }, { id: 'e-2', nombre: 'Mundo JC', esActiva: false }],
      empresaActivaId: 'e-1', isLoading: false, isError: false,
    })
    rerender(<MemoryRouter><ProveedorList /></MemoryRouter>)
    expect(ultimosFiltros().empresaId).toBe('e-1')
  })

  it('distingue visualmente a los inactivos', () => {
    abrir()
    expect(screen.getAllByText('Inactivo')).toHaveLength(1)
  })

  it('el buscador tiene etiqueta y espera a que se deje de tipear', () => {
    abrir()
    const buscador = screen.getByLabelText('Buscar por razón social o CUIT')
    fireEvent.change(buscador, { target: { value: 'ala' } })
    act(() => { vi.advanceTimersByTime(200) })
    expect(ultimosFiltros().texto).toBe('')
    act(() => { vi.advanceTimersByTime(100) })
    expect(ultimosFiltros().texto).toBe('ala')
  })

  it('el filtro de estado pide inactivos/todos y vuelve a la página 1', () => {
    mocks.useListarProveedores.mockReturnValue(respuesta([proveedor(1)], { total: 60 }))
    abrir()
    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente/i }))
    expect(ultimosFiltros().pagina).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: 'Inactivos' }))
    expect(ultimosFiltros()).toMatchObject({ estado: 'inactivos', pagina: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Todos' }))
    expect(ultimosFiltros().estado).toBe('todos')
  })

  it('pagina en el servidor conservando búsqueda y estado', () => {
    mocks.useListarProveedores.mockReturnValue(respuesta([proveedor(1)], { total: 60 }))
    abrir()
    fireEvent.change(screen.getByLabelText('Buscar por razón social o CUIT'), { target: { value: 'uno' } })
    act(() => { vi.advanceTimersByTime(300) })
    fireEvent.click(screen.getByRole('button', { name: 'Todos' }))
    expect(screen.getByText('1–25 de 60')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente/i }))
    expect(ultimosFiltros()).toMatchObject({ texto: 'uno', estado: 'todos', pagina: 2 })
  })

  it('si estando en la página 2 el servidor devuelve 0 filas, vuelve a la página 1', () => {
    mocks.useListarProveedores.mockImplementation((f: { pagina: number }) =>
      f.pagina === 2 ? respuesta([], { total: 0 }) : respuesta([proveedor(1)], { total: 60 }))
    abrir()
    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente/i }))
    expect(ultimosFiltros().pagina).toBe(1)
  })

  it('con filtros y sin coincidencias muestra «Sin resultados»', () => {
    mocks.useListarProveedores.mockReturnValue(respuesta([]))
    abrir()
    fireEvent.change(screen.getByLabelText('Buscar por razón social o CUIT'), { target: { value: 'zzz' } })
    act(() => { vi.advanceTimersByTime(300) })
    expect(screen.getByText('Sin resultados')).toBeInTheDocument()
  })

  it('sin proveedores ni filtros invita a crear el primero (a quien puede)', () => {
    mocks.useListarProveedores.mockReturnValue(respuesta([]))
    abrir()
    expect(screen.getByText('Todavía no hay proveedores cargados.')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Nuevo proveedor' })).toHaveLength(2)
  })

  it('sin permiso de edición el vacío no ofrece crear', () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    mocks.useListarProveedores.mockReturnValue(respuesta([]))
    abrir()
    expect(screen.getByText('Todavía no hay proveedores cargados.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nuevo proveedor' })).not.toBeInTheDocument()
  })

  it('muestra el estado de carga', () => {
    mocks.useListarProveedores.mockReturnValue(respuesta([], { isLoading: true }))
    abrir()
    expect(screen.queryByText('Sin resultados')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('ante un error muestra el estado de error con «Reintentar»', () => {
    mocks.useListarProveedores.mockReturnValue(respuesta([], { isError: true }))
    abrir()
    expect(screen.getByText('No pudimos cargar los proveedores.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(mocks.refetch).toHaveBeenCalled()
  })

  it('«Nuevo proveedor» abre el diálogo de alta y al guardar recarga el listado', () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo proveedor' }))
    expect(screen.getByRole('dialog', { name: 'Nuevo proveedor' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar proveedor' }))
    expect(mocks.refetch).toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('con solo lectura no ofrece «Nuevo proveedor» pero sí «Ver ficha»', () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    abrir()
    expect(screen.queryByRole('button', { name: 'Nuevo proveedor' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver ficha de Proveedor 1' })).toBeInTheDocument()
  })
})
