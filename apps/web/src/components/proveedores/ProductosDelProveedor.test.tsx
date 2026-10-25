import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ useProductosDeProveedor: vi.fn(), recargar: vi.fn() }))

vi.mock('../../hooks/useProductosDeProveedor', () => ({ useProductosDeProveedor: mocks.useProductosDeProveedor }))

import type { ProductoDeProveedor } from '../../hooks/useProductosDeProveedor'
import { ProductosDelProveedor } from './ProductosDelProveedor'

const producto = (n: number, extra: Partial<ProductoDeProveedor> = {}): ProductoDeProveedor => ({
  id: `p-${n}`, nombre: `Producto ${n}`, codigo_proveedor: `COD-${n}`, activo: true, ...extra,
})

const respuesta = (productos: ProductoDeProveedor[], extra: Record<string, unknown> = {}) => ({
  productos, total: productos.length, cargando: false, hayError: false, recargar: mocks.recargar, ...extra,
})

const abrir = () => render(<MemoryRouter><ProductosDelProveedor proveedorId="prv-1" /></MemoryRouter>)

describe('ProductosDelProveedor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('pide la primera página de 10 y pagina en el servidor', () => {
    mocks.useProductosDeProveedor.mockReturnValue(respuesta([producto(1)], { total: 25 }))
    abrir()
    expect(mocks.useProductosDeProveedor).toHaveBeenLastCalledWith('prv-1', 1, 10)
    expect(screen.getByText('1–10 de 25')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /siguiente|next/i }))
    expect(mocks.useProductosDeProveedor).toHaveBeenLastCalledWith('prv-1', 2, 10)
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
