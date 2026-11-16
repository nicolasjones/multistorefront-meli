import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../test/axe'
import { ErrorConReintento } from './ErrorConReintento'

// F-TDA-17 (SC-007, FR-045): mensaje anunciado, «Reintentar» operable con teclado y sin violaciones de axe.
describe('ErrorConReintento (FR-045)', () => {
  it('anuncia el mensaje estándar como alerta y reintenta al activar el botón', () => {
    const alReintentar = vi.fn()
    render(<ErrorConReintento alReintentar={alReintentar} />)
    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos cargar esta página.')
    expect(screen.getByRole('alert')).toHaveTextContent('Revisá tu conexión y probá de nuevo.')
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(alReintentar).toHaveBeenCalledTimes(1)
  })

  it('acepta un título propio y el botón recibe foco con teclado', () => {
    render(<ErrorConReintento titulo="No pudimos cargar los productos." alReintentar={() => undefined} />)
    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos cargar los productos.')
    const boton = screen.getByRole('button', { name: 'Reintentar' })
    boton.focus()
    expect(boton).toHaveFocus()
  })

  it('no tiene violaciones de accesibilidad', async () => {
    const { container } = render(<ErrorConReintento alReintentar={() => undefined} />)
    expect(await violacionesAxe(container)).toEqual([])
  })
})
