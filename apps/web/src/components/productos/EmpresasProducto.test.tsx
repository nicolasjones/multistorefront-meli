import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EmpresasProducto } from './EmpresasProducto'

const EMPRESAS = [
  { id: 'emp-1', nombre: 'San Javucho', activa: true },
  { id: 'emp-2', nombre: 'Mundo JC', activa: true },
  { id: 'emp-3', nombre: 'Vieja SA', activa: false },
]

describe('EmpresasProducto', () => {
  it('muestra una fila por empresa (sin asumir cuántas) con «Precio: —» y un interruptor accesible', () => {
    render(<EmpresasProducto empresas={EMPRESAS} seleccion={['emp-1']} onCambiar={vi.fn()} />)
    expect(screen.getAllByRole('switch')).toHaveLength(3)
    expect(screen.getByRole('switch', { name: 'San Javucho' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Mundo JC' })).not.toBeChecked()
    expect(screen.getAllByText('Precio: —')).toHaveLength(3)
    expect(screen.getByText('Vieja SA (inactiva)')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Vieja SA (inactiva)' })).not.toBeChecked()
  })

  it('marcar y desmarcar devuelve la selección completa y actualiza la nota de visibilidad', () => {
    const onCambiar = vi.fn()
    const { rerender } = render(<EmpresasProducto empresas={EMPRESAS} seleccion={[]} onCambiar={onCambiar} />)
    expect(screen.getByText('No se muestra en ninguna store: el producto no aparece en el catálogo público.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch', { name: 'Mundo JC' }))
    expect(onCambiar).toHaveBeenLastCalledWith(['emp-2'])
    rerender(<EmpresasProducto empresas={EMPRESAS} seleccion={['emp-1', 'emp-2']} onCambiar={onCambiar} />)
    expect(screen.getByText('Visible en San Javucho y Mundo JC.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch', { name: 'San Javucho' }))
    expect(onCambiar).toHaveBeenLastCalledWith(['emp-2'])
  })

  it('en solo lectura los interruptores están deshabilitados', () => {
    render(<EmpresasProducto empresas={EMPRESAS} seleccion={['emp-1']} onCambiar={vi.fn()} soloLectura />)
    for (const interruptor of screen.getAllByRole('switch')) expect(interruptor).toBeDisabled()
  })

  it('cargando, error con reintento y sin empresas', () => {
    const reintentar = vi.fn()
    const { rerender } = render(<EmpresasProducto empresas={[]} seleccion={[]} onCambiar={vi.fn()} cargando />)
    expect(screen.getByText('Cargando empresas…')).toBeInTheDocument()
    rerender(<EmpresasProducto empresas={[]} seleccion={[]} onCambiar={vi.fn()} hayError onReintentar={reintentar} />)
    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos cargar las empresas.')
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar empresas' }))
    expect(reintentar).toHaveBeenCalled()
    rerender(<EmpresasProducto empresas={[]} seleccion={[]} onCambiar={vi.fn()} />)
    expect(screen.getByText('Todavía no hay empresas cargadas.')).toBeInTheDocument()
  })
})
