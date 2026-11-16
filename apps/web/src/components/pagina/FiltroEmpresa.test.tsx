import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FiltroEmpresa } from './FiltroEmpresa'

const EMPRESAS = [
  { id: 'e-1', nombre: 'San Javucho' },
  { id: 'e-2', nombre: 'Mundo JC' },
]

describe('FiltroEmpresa', () => {
  it('muestra «Todas las tiendas» y una píldora por empresa, con la elegida activa', () => {
    render(<FiltroEmpresa empresas={EMPRESAS} valor="e-2" onCambiar={vi.fn()} />)

    expect(screen.getByRole('group', { name: 'Filtrar por tienda' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Todas las tiendas' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'San Javucho' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Mundo JC' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('elegir una empresa y volver a «Todas las tiendas» cambia el filtro', () => {
    const onCambiar = vi.fn()
    const { rerender } = render(<FiltroEmpresa empresas={EMPRESAS} valor={null} onCambiar={onCambiar} />)

    fireEvent.click(screen.getByRole('button', { name: 'Mundo JC' }))
    expect(onCambiar).toHaveBeenLastCalledWith('e-2')

    rerender(<FiltroEmpresa empresas={EMPRESAS} valor="e-2" onCambiar={onCambiar} />)
    fireEvent.click(screen.getByRole('button', { name: 'Todas las tiendas' }))
    expect(onCambiar).toHaveBeenLastCalledWith(null)
  })

  it('no cambia el filtro al volver a tocar la empresa ya elegida', () => {
    const onCambiar = vi.fn()
    render(<FiltroEmpresa empresas={EMPRESAS} valor="e-1" onCambiar={onCambiar} />)

    fireEvent.click(screen.getByRole('button', { name: 'San Javucho' }))
    expect(onCambiar).not.toHaveBeenCalled()
  })

  it('personaliza la etiqueta, el texto de ayuda y el nombre accesible', () => {
    render(
      <FiltroEmpresa
        empresas={EMPRESAS}
        valor={null}
        onCambiar={vi.fn()}
        etiqueta="Empresa"
        ariaLabel="Filtrar por empresa"
        textoAyuda="Elegí con qué empresa trabajar."
      />,
    )

    expect(screen.getByText('Empresa')).toBeInTheDocument()
    expect(screen.getByText('Elegí con qué empresa trabajar.')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Filtrar por empresa' })).toBeInTheDocument()
  })

  it('mientras carga no muestra el filtro; con error o sin empresas explica sin romper', () => {
    const { rerender } = render(<FiltroEmpresa empresas={EMPRESAS} valor={null} onCambiar={vi.fn()} cargando />)
    expect(screen.queryByRole('group')).not.toBeInTheDocument()

    rerender(<FiltroEmpresa empresas={EMPRESAS} valor={null} onCambiar={vi.fn()} hayError />)
    expect(screen.getByText('No pudimos cargar las tiendas para filtrar.')).toBeInTheDocument()

    rerender(<FiltroEmpresa empresas={[]} valor={null} onCambiar={vi.fn()} />)
    expect(screen.queryByText('No pudimos cargar las tiendas para filtrar.')).not.toBeInTheDocument()
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
  })
})
