import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BarraSeleccion } from './BarraSeleccion'

const props = () => ({ onMoverCategoria: vi.fn(), onCambiarEstado: vi.fn(), onCambiarEmpresas: vi.fn(), onQuitar: vi.fn() })

describe('BarraSeleccion', () => {
  it('sin selección (lista vacía) no se muestra', () => {
    const { container } = render(<BarraSeleccion cantidad={0} {...props()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('muestra «N seleccionados» y dispara cada acción', () => {
    const p = props()
    render(<BarraSeleccion cantidad={3} {...p} />)
    expect(screen.getByText('3 seleccionados')).toBeInTheDocument()
    expect(screen.queryByText(/Máximo 100/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Mover de categoría' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar estado' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar empresas' }))
    fireEvent.click(screen.getByRole('button', { name: 'Quitar selección' }))
    expect(p.onMoverCategoria).toHaveBeenCalledTimes(1)
    expect(p.onCambiarEstado).toHaveBeenCalledTimes(1)
    expect(p.onCambiarEmpresas).toHaveBeenCalledTimes(1)
    expect(p.onQuitar).toHaveBeenCalledTimes(1)
  })

  it('con 100 avisa el máximo', () => {
    render(<BarraSeleccion cantidad={100} {...props()} />)
    expect(screen.getByText('Máximo 100 a la vez')).toBeInTheDocument()
  })
})
