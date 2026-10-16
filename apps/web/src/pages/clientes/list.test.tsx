import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useBuscarClientes: vi.fn(),
  useNivelSeccion: vi.fn(),
  refetch: vi.fn(),
}))

vi.mock('../../hooks/useBuscarClientes', () => ({ useBuscarClientes: mocks.useBuscarClientes }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('@refinedev/mui', () => ({ CreateButton: () => <button type="button">Nuevo cliente</button> }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import type { ClienteListado } from '../../hooks/useBuscarClientes'
import { ClienteList } from './list'

const cliente = (n: number, extra: Partial<ClienteListado> = {}): ClienteListado => ({
  id: `c-${n}`, numero: n, nombre: `Cliente ${n}`, documento: null, correo: null, telefono: null, celular: null,
  localidad: null, tipo: 'minorista', es_consumidor_final: false, archivado_en: null, ...extra,
})

const respuesta = (clientes: ClienteListado[], extra: Record<string, unknown> = {}) => ({
  clientes, total: clientes.length, isLoading: false, isFetching: false, isError: false, refetch: mocks.refetch, ...extra,
})

const ultimosFiltros = () => mocks.useBuscarClientes.mock.calls.at(-1)![0]

const abrir = () => render(<MemoryRouter><ClienteList /></MemoryRouter>)

describe('ClienteList', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.useBuscarClientes.mockReturnValue(respuesta([cliente(1), cliente(2, { tipo: 'mayorista', documento: '30-1', localidad: 'Rosario' })]))
  })
  afterEach(() => vi.useRealTimers())

  it('lista los clientes con sus datos y un acceso a la ficha', () => {
    abrir()
    expect(ultimosFiltros()).toEqual({ texto: '', tipo: null, archivados: false, pagina: 1, tamano: 25 })
    expect(screen.getAllByText('Cliente 2').length).toBeGreaterThan(0)
    expect(screen.getByRole('cell', { name: 'Mayorista' })).toBeInTheDocument()
    expect(screen.getByText('Rosario')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver Cliente 2' })).toHaveAttribute('href', '/clientes/show/c-2')
  })

  it('espera a que se deje de tipear antes de buscar y manda el texto tal cual (el escape es del servidor)', () => {
    abrir()
    const buscador = screen.getByLabelText('Buscar clientes')
    fireEvent.change(buscador, { target: { value: '50%' } })
    act(() => { vi.advanceTimersByTime(200) })
    expect(ultimosFiltros().texto).toBe('')
    fireEvent.change(buscador, { target: { value: '50%_' } })
    act(() => { vi.advanceTimersByTime(200) })
    expect(ultimosFiltros().texto).toBe('')
    act(() => { vi.advanceTimersByTime(100) })
    expect(ultimosFiltros().texto).toBe('50%_')
  })

  it('combina tipo y archivados, vuelve a la página 1 y no se desmarca al repetir el filtro', () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Mayorista' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archivados' }))
    expect(ultimosFiltros()).toMatchObject({ tipo: 'mayorista', archivados: true, pagina: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Mayorista' }))
    expect(ultimosFiltros().tipo).toBe('mayorista')
    fireEvent.click(screen.getByRole('button', { name: 'Todos' }))
    expect(ultimosFiltros()).toMatchObject({ tipo: null, archivados: true })
  })

  it('pagina en el servidor: muestra el total y pide la página siguiente', () => {
    mocks.useBuscarClientes.mockReturnValue(respuesta([cliente(1), cliente(2)], { total: 60 }))
    abrir()
    expect(screen.getByText('1–25 de 60')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente/i }))
    expect(ultimosFiltros().pagina).toBe(2)
  })

  it('al cambiar un filtro estando en otra página vuelve a la primera', () => {
    mocks.useBuscarClientes.mockReturnValue(respuesta([cliente(1)], { total: 60 }))
    abrir()
    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente/i }))
    expect(ultimosFiltros().pagina).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: 'Minorista' }))
    expect(ultimosFiltros()).toMatchObject({ tipo: 'minorista', pagina: 1 })
  })

  it('sin clientes ni filtros muestra el estado vacío', () => {
    mocks.useBuscarClientes.mockReturnValue(respuesta([]))
    abrir()
    expect(screen.getByText('Todavía no hay clientes cargados.')).toBeInTheDocument()
  })

  it('con filtros y sin coincidencias muestra «sin resultados», no el vacío', () => {
    mocks.useBuscarClientes.mockReturnValue(respuesta([]))
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Mayorista' }))
    expect(screen.getByText('No encontramos clientes con esos criterios.')).toBeInTheDocument()
    expect(screen.queryByText('Todavía no hay clientes cargados.')).not.toBeInTheDocument()
  })

  it('muestra la carga inicial sin ocultar el buscador', () => {
    mocks.useBuscarClientes.mockReturnValue(respuesta([], { isLoading: true }))
    abrir()
    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
    expect(screen.getByLabelText('Buscar clientes')).toBeInTheDocument()
  })

  it('ante un error ofrece reintentar y conserva los filtros', () => {
    mocks.useBuscarClientes.mockReturnValue(respuesta([], { isError: true }))
    abrir()
    expect(screen.getByText('No pudimos cargar los clientes.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(mocks.refetch).toHaveBeenCalledTimes(1)
  })

  it('marca los archivados', () => {
    mocks.useBuscarClientes.mockReturnValue(respuesta([cliente(3, { archivado_en: '2026-10-01T00:00:00Z' })]))
    abrir()
    expect(screen.getByText('Archivado')).toBeInTheDocument()
  })

  it('«Nuevo cliente» solo aparece con edición', () => {
    abrir()
    expect(screen.getByRole('button', { name: 'Nuevo cliente' })).toBeInTheDocument()
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    abrir()
    expect(screen.getAllByRole('button', { name: 'Nuevo cliente' })).toHaveLength(1)
  })
})
