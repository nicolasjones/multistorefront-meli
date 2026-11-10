import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../test/axe'
import { BloqueTiendas } from './BloqueTiendas'

const TIENDAS = [
  { empresaId: 'e-1', nombre: 'San Javucho', habilitada: true, estado: 'activa' as const },
  { empresaId: 'e-2', nombre: 'Mundo JC', habilitada: true, estado: 'suspendida' as const },
  { empresaId: 'e-3', nombre: 'Vieja SA', habilitada: false, estado: 'no_habilitado' as const },
]

describe('BloqueTiendas (FR-012)', () => {
  it('muestra título, subtítulo y una fila por tienda con su texto y chip', () => {
    render(<BloqueTiendas tiendas={TIENDAS} />)

    expect(screen.getByRole('heading', { name: 'Tiendas' })).toBeInTheDocument()
    expect(screen.getByText('El cliente es de la organización. Acá elegís en qué tiendas puede comprar.')).toBeInTheDocument()
    expect(screen.getByText('San Javucho')).toBeInTheDocument()
    expect(screen.getAllByText('Compra con su tipo y escala')).toHaveLength(2)
    expect(screen.getByText('No ve ni compra en esta tienda')).toBeInTheDocument()
    expect(screen.getByText('Activa')).toBeInTheDocument()
    expect(screen.getByText('Suspendida')).toBeInTheDocument()
    expect(screen.getByText('No habilitado')).toBeInTheDocument()
  })

  it('el interruptor «Habilitado en la tienda» informa el cambio de esa tienda', () => {
    const onCambiarHabilitada = vi.fn()
    render(<BloqueTiendas tiendas={TIENDAS} puedeEditar onCambiarHabilitada={onCambiarHabilitada} />)

    const interruptor = screen.getByRole('switch', { name: 'Habilitado en la tienda: Mundo JC' })
    expect(interruptor).toBeChecked()
    fireEvent.click(interruptor)
    expect(onCambiarHabilitada).toHaveBeenCalledWith('e-2', false)
  })

  it('sin edición los interruptores quedan deshabilitados (solo lectura)', () => {
    render(<BloqueTiendas tiendas={TIENDAS} />)
    expect(screen.getByRole('switch', { name: 'Habilitado en la tienda: San Javucho' })).toBeDisabled()
  })

  it('muestra el vacío cuando la organización no tiene tiendas', () => {
    render(<BloqueTiendas tiendas={[]} />)
    expect(screen.getByText('La organización todavía no tiene tiendas cargadas.')).toBeInTheDocument()
  })

  it.each([320, 768, 1440])('no tiene violaciones de accesibilidad a %i px', async (ancho) => {
    const { container } = render(<BloqueTiendas tiendas={TIENDAS} puedeEditar />)
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: ancho })
    expect(await violacionesAxe(container)).toEqual([])
  })
})
