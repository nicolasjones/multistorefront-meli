import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FiltrosDimension } from './FiltrosDimension'

const productos = [{ id: 'p-1', nombre: 'Auricular', sku: 'AUR-1' }, { id: 'p-2', nombre: 'Cable', sku: null }]
const categorias = [{ id: 'k-1', ruta: 'Audio', nivel: 0 as const }, { id: 'k-2', ruta: 'Audio > Cables', nivel: 1 as const }]
const provincias = ['Córdoba', 'Santa Fe']

const abrir = (extra: Partial<React.ComponentProps<typeof FiltrosDimension>> = {}) => {
  const props = {
    producto: null, categoriaId: null, provincia: null,
    alCambiarProducto: vi.fn(), alCambiarCategoria: vi.fn(), alCambiarProvincia: vi.fn(), alBuscarProducto: vi.fn(),
    productos, categorias, provincias, ...extra,
  }
  render(<FiltrosDimension {...props} />)
  return props
}

describe('FiltrosDimension', () => {
  it('ofrece Producto, Categoría y Provincia dentro de un grupo con nombre accesible', () => {
    abrir()
    const grupo = screen.getByRole('group', { name: 'Filtros por producto, categoría y provincia' })
    for (const nombre of ['Producto', 'Categoría', 'Provincia']) {
      expect(within(grupo).getByRole('combobox', { name: nombre })).toBeInTheDocument()
    }
  })

  it('el producto se busca por teclado y se elige por nombre y SKU, sin mostrar identificadores', () => {
    const props = abrir()
    const caja = screen.getByRole('combobox', { name: 'Producto' })
    fireEvent.change(caja, { target: { value: 'aur' } })
    expect(props.alBuscarProducto).toHaveBeenCalledWith('aur')
    fireEvent.keyDown(caja, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: 'Auricular · AUR-1' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Cable' })).toBeInTheDocument()
    expect(screen.queryByText('p-1')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: 'Auricular · AUR-1' }))
    expect(props.alCambiarProducto).toHaveBeenCalledWith(productos[0])
  })

  it('la categoría se elige con su ruta y entrega el id', () => {
    const props = abrir()
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Categoría' }), { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: 'Audio' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: 'Audio > Cables' }))
    expect(props.alCambiarCategoria).toHaveBeenCalledWith('k-2')
  })

  it('la provincia se elige de la lista y entrega el nombre', () => {
    const props = abrir()
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Provincia' }), { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('option', { name: 'Santa Fe' }))
    expect(props.alCambiarProvincia).toHaveBeenCalledWith('Santa Fe')
  })

  it('muestra la selección vigente y el producto elegido aunque la búsqueda ya no lo devuelva', () => {
    abrir({ producto: { id: 'p-9', nombre: 'Mouse', sku: 'MOU-1' }, categoriaId: 'k-2', provincia: 'Córdoba', productos: [] })
    expect(screen.getByRole('combobox', { name: 'Producto' })).toHaveValue('Mouse · MOU-1')
    expect(screen.getByRole('combobox', { name: 'Categoría' })).toHaveValue('Audio > Cables')
    expect(screen.getByRole('combobox', { name: 'Provincia' })).toHaveValue('Córdoba')
  })

  it('limpiar un filtro entrega null', () => {
    const props = abrir({ provincia: 'Córdoba' })
    fireEvent.click(screen.getByTitle('Borrar'))
    expect(props.alCambiarProvincia).toHaveBeenCalledWith(null)
  })

  it('sin coincidencias avisa con un texto claro', () => {
    abrir({ productos: [] })
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Producto' }), { key: 'ArrowDown' })
    expect(screen.getByText('No hay productos que coincidan')).toBeInTheDocument()
  })
})
