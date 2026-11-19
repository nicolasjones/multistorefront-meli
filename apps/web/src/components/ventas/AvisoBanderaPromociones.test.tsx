import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../test/axe'
import { AvisoBanderaPromociones } from './AvisoBanderaPromociones'

describe('AvisoBanderaPromociones', () => {
  it('sin mensaje deja la región viva vacía', () => {
    render(<AvisoBanderaPromociones mensaje={null} onCerrar={() => {}} />)
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('con mensaje lo anuncia y se puede cerrar', () => {
    const onCerrar = vi.fn()
    render(<AvisoBanderaPromociones mensaje="Las promociones se activaron." onCerrar={onCerrar} />)
    expect(screen.getByRole('status').textContent).toContain('Las promociones se activaron.')
    fireEvent.click(screen.getByRole('button', { name: /close|cerrar/i }))
    expect(onCerrar).toHaveBeenCalledTimes(1)
  })

  it.each([320, 768, 1440])('sin violaciones de axe a %i px', async (ancho) => {
    window.innerWidth = ancho
    const { container } = render(<AvisoBanderaPromociones mensaje="Las promociones se desactivaron." onCerrar={() => {}} />)
    expect(await violacionesAxe(container)).toEqual([])
  })
})
