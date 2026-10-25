import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { FiltroTienda } from './FiltroTienda'

const empresas = [
  { id: 'e-1', nombre: 'San Javucho', activa: true },
  { id: 'e-2', nombre: 'Mundo JC', activa: true },
]

// Envoltorio controlado: imita a la pantalla, que refleja el valor elegido.
function Controlado({ inicial = null, onCambiar = vi.fn() }: { inicial?: string | null; onCambiar?: (id: string | null) => void }) {
  const [valor, setValor] = useState<string | null>(inicial)
  return <FiltroTienda empresas={empresas} valor={valor} onCambiar={(id) => { onCambiar(id); setValor(id) }} />
}

describe('FiltroTienda', () => {
  it('muestra «Todas las tiendas» y una opción por empresa, con la elegida activa', () => {
    render(<FiltroTienda empresas={empresas} valor="e-2" onCambiar={vi.fn()} />)
    expect(screen.getByRole('group', { name: 'Filtrar por tienda' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Todas las tiendas' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Mundo JC' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('avisa el cambio con el id de la empresa y con null al elegir «Todas»', () => {
    const onCambiar = vi.fn()
    render(<Controlado onCambiar={onCambiar} />)
    fireEvent.click(screen.getByRole('button', { name: 'San Javucho' }))
    expect(onCambiar).toHaveBeenLastCalledWith('e-1')
    fireEvent.click(screen.getByRole('button', { name: 'Todas las tiendas' }))
    expect(onCambiar).toHaveBeenLastCalledWith(null)
  })

  it('oculta la fila si no hay tiendas en la organización', () => {
    render(<FiltroTienda empresas={[]} valor={null} onCambiar={vi.fn()} />)
    expect(screen.queryByRole('group', { name: 'Filtrar por tienda' })).not.toBeInTheDocument()
  })

  it('no rompe el listado si el catálogo de tiendas falla', () => {
    render(<FiltroTienda empresas={[]} valor={null} onCambiar={vi.fn()} hayError />)
    expect(screen.getByText('No pudimos cargar las tiendas para filtrar.')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Filtrar por tienda' })).not.toBeInTheDocument()
  })
})
