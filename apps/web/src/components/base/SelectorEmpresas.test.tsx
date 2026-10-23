import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SelectorEmpresas } from './SelectorEmpresas'

const EMPRESAS = [
  { id: 'e-1', nombre: 'San Javucho', activa: true },
  { id: 'e-2', nombre: 'Mundo JC', activa: true },
  { id: 'e-3', nombre: 'Vieja SA', activa: false },
]

const base = {
  empresas: EMPRESAS,
  seleccion: [] as string[],
  onCambiar: vi.fn(),
  etiqueta: 'Disponible en',
}

describe('SelectorEmpresas', () => {
  it('muestra una casilla por empresa, con las elegidas marcadas y las inactivas señaladas', () => {
    render(<SelectorEmpresas {...base} seleccion={['e-1']} />)

    expect(screen.getByRole('group', { name: 'Disponible en' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'San Javucho' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Mundo JC' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Vieja SA (inactiva)' })).not.toBeChecked()
  })

  it('marcar y desmarcar devuelve la selección completa', () => {
    const onCambiar = vi.fn()
    const { rerender } = render(<SelectorEmpresas {...base} seleccion={['e-1']} onCambiar={onCambiar} />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Mundo JC' }))
    expect(onCambiar).toHaveBeenLastCalledWith(['e-1', 'e-2'])

    rerender(<SelectorEmpresas {...base} seleccion={['e-1', 'e-2']} onCambiar={onCambiar} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'San Javucho' }))
    expect(onCambiar).toHaveBeenLastCalledWith(['e-2'])
  })

  it('respeta el deshabilitado y muestra el error de validación sin ocultar las casillas', () => {
    render(<SelectorEmpresas {...base} seleccion={['e-1']} deshabilitado error="Elegí al menos una empresa." />)

    expect(screen.getByRole('checkbox', { name: 'San Javucho' })).toBeDisabled()
    expect(screen.getByText('Elegí al menos una empresa.')).toBeInTheDocument()
  })

  it('cubre carga, error de carga, vacío y texto de ayuda', () => {
    const { rerender } = render(<SelectorEmpresas {...base} cargando />)
    expect(screen.getByRole('progressbar', { name: 'Cargando empresas' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()

    rerender(<SelectorEmpresas {...base} hayError mensajeError="No pudimos cargar las tiendas." />)
    expect(screen.getByText('No pudimos cargar las tiendas.')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()

    rerender(<SelectorEmpresas {...base} empresas={[]} ayuda="Sin empresas no hay nada que elegir." />)
    expect(screen.getByText('La organización todavía no tiene empresas cargadas.')).toBeInTheDocument()
    expect(screen.getByText('Sin empresas no hay nada que elegir.')).toBeInTheDocument()
  })
})
