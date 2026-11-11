import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../test/axe'
import { PantallaError } from './PantallaError'

// F-TDA-19 (FR-004, FR-005, SC-001): pantalla completa de error, anunciada, sin detalle técnico.
describe('PantallaError (FR-004)', () => {
  it('anuncia el mensaje como alerta, sin detalle técnico', () => {
    render(<PantallaError alReintentar={() => undefined} />)
    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos cargar esta página.')
    expect(screen.getByRole('heading', { level: 1, name: 'No pudimos cargar esta página.' })).toBeInTheDocument()
  })

  it('«Reintentar» y «Volver al inicio» llaman a su acción y se operan con teclado', () => {
    const alReintentar = vi.fn()
    const alVolverAlInicio = vi.fn()
    render(<PantallaError alReintentar={alReintentar} alVolverAlInicio={alVolverAlInicio} />)
    const reintentar = screen.getByRole('button', { name: 'Reintentar' })
    reintentar.focus()
    expect(reintentar).toHaveFocus()
    fireEvent.click(reintentar)
    fireEvent.click(screen.getByRole('button', { name: 'Volver al inicio' }))
    expect(alReintentar).toHaveBeenCalledTimes(1)
    expect(alVolverAlInicio).toHaveBeenCalledTimes(1)
  })

  it('dentro de la tienda no repite el landmark main', () => {
    const { container } = render(<PantallaError dentroDeTienda alReintentar={() => undefined} />)
    expect(container.querySelector('main')).toBeNull()
  })

  it('no tiene violaciones de accesibilidad', async () => {
    const { container } = render(<PantallaError alReintentar={() => undefined} />)
    expect(await violacionesAxe(container)).toEqual([])
  })
})
