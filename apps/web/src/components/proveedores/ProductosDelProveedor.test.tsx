import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ useProductosDeProveedor: vi.fn(), useNivelSeccion: vi.fn(), recargar: vi.fn(), imagenes: new Map<string, string>() }))

vi.mock('../../hooks/useImagenesProductos', () => ({ useImagenesProductos: () => mocks.imagenes }))

vi.mock('../../hooks/useProductosDeProveedor', () => ({ useProductosDeProveedor: mocks.useProductosDeProveedor }))

vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))

import type { ProductoDeProveedor } from '../../hooks/useProductosDeProveedor'
import { ProductosDelProveedor } from './ProductosDelProveedor'

const producto = (n: number, extra: Partial<ProductoDeProveedor> = {}): ProductoDeProveedor => ({
  id: `p-${n}`, nombre: `Producto ${n}`, codigo_proveedor: `COD-${n}`, activo: true, moneda: 'USD', costo: null, ...extra,
})

const respuesta = (productos: ProductoDeProveedor[], extra: Record<string, unknown> = {}) => ({
  productos, total: productos.length, cargando: false, hayError: false, recargar: mocks.recargar, ...extra,
})

const abrir = () => render(<MemoryRouter><ProductosDelProveedor proveedorId="prv-1" /></MemoryRouter>)

describe('ProductosDelProveedor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.imagenes.clear()
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'ninguno', isLoading: false })
    mocks.useProductosDeProveedor.mockReturnValue(respuesta([producto(1), producto(2, { activo: false, codigo_proveedor: null })]))
  })

  it('lista producto, código del proveedor y Ver producto; marca los inactivos', () => {
    abrir()
    expect(screen.getByRole('heading', { name: 'Productos' })).toBeInTheDocument()
    for (const encabezado of ['Producto', 'Código del proveedor']) {
      expect(screen.getByRole('columnheader', { name: encabezado })).toBeInTheDocument()
    }
    expect(screen.getByText('COD-1')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByText('Inactivo')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver producto Producto 1' })).toHaveAttribute('href', '/productos/p-1/edit')
  })

  it('con Rentabilidad muestra la columna Costo con moneda y «—» si no hay costo', () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    mocks.useProductosDeProveedor.mockReturnValue(respuesta([producto(1, { costo: 1234.5 }), producto(2)]))
    abrir()
    expect(mocks.useNivelSeccion).toHaveBeenCalledWith('rentabilidad')
    expect(screen.getByRole('columnheader', { name: 'Costo' })).toBeInTheDocument()
    expect(screen.getByText('USD 1.234,50')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('sin Rentabilidad no muestra la columna Costo', () => {
    mocks.useProductosDeProveedor.mockReturnValue(respuesta([producto(1, { costo: 99 })]))
    abrir()
    expect(screen.queryByRole('columnheader', { name: 'Costo' })).not.toBeInTheDocument()
    expect(screen.queryByText(/99/)).not.toBeInTheDocument()
  })

  it('pide la primera tanda de 10 y «Cargar más» pide la siguiente', () => {
    mocks.useProductosDeProveedor.mockReturnValue(respuesta([producto(1)], { total: 25 }))
    abrir()
    expect(mocks.useProductosDeProveedor).toHaveBeenLastCalledWith('prv-1', 1, 10)
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
    expect(mocks.useProductosDeProveedor).toHaveBeenLastCalledWith('prv-1', 2, 10)
  })

  it('«Cargar más» suma la tanda siguiente a la ya mostrada y no hay paginación numerada', () => {
    mocks.useProductosDeProveedor.mockImplementation((_id: string, pagina: number) =>
      respuesta(pagina === 2 ? [producto(2)] : [producto(1)], { total: 2 }))
    abrir()
    expect(screen.queryByText(/por página/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
    expect(screen.getByText('Producto 1')).toBeInTheDocument()
    expect(screen.getByText('Producto 2')).toBeInTheDocument()
    expect(screen.getByText('No hay más resultados.')).toBeInTheDocument()
  })

  it('muestra la imagen principal del producto como miniatura junto al nombre', () => {
    mocks.imagenes.set('p-1', 'https://ejemplo/p1.png')
    const { container } = abrir()
    expect(container.querySelector('img[src="https://ejemplo/p1.png"]')).not.toBeNull()
    expect(container.querySelectorAll('img')).toHaveLength(1)
  })

  it('sin productos muestra el vacío', () => {
    mocks.useProductosDeProveedor.mockReturnValue(respuesta([]))
    abrir()
    expect(screen.getByText('Este proveedor todavía no tiene productos.')).toBeInTheDocument()
  })

  it('un error queda aislado y permite reintentar', () => {
    mocks.useProductosDeProveedor.mockReturnValue(respuesta([], { hayError: true }))
    abrir()
    expect(screen.getByText('No pudimos cargar los productos del proveedor.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }))
    expect(mocks.recargar).toHaveBeenCalled()
  })

  it('mientras carga muestra el estado de carga compartido', () => {
    mocks.useProductosDeProveedor.mockReturnValue(respuesta([], { cargando: true }))
    abrir()
    expect(screen.queryByText('Este proveedor todavía no tiene productos.')).not.toBeInTheDocument()
  })
})
