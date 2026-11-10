import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { violacionesAxe } from '../../test/axe'
import { ComoSeCalcula } from './ComoSeCalcula'

describe('ComoSeCalcula (F-PRE-09, FR-025)', () => {
  it('muestra los cuatro pasos del prototipo, en orden y con el nombre de la empresa', () => {
    render(<ComoSeCalcula nombreEmpresa="Mundo JC" />)
    const pasos = within(screen.getByRole('region', { name: 'Cómo se calcula' })).getAllByRole('listitem')
    expect(pasos.map((p) => p.textContent)).toEqual([
      'Precio central del producto (en USD se multiplica por el dólar del día).',
      'Ajuste de Mundo JC, si lo tiene.',
      'Precio propio del producto en esta empresa, si existe: reemplaza al calculado.',
      'Mercado Libre parte de este precio y suma su recargo (pestaña Mercado Libre).',
    ])
  })

  it('es una lista ordenada (el orden importa)', () => {
    render(<ComoSeCalcula nombreEmpresa="Mundo JC" />)
    expect(screen.getByRole('list').tagName).toBe('OL')
  })

  it.each([320, 768, 1440])('no tiene violaciones de axe a %i px', async (ancho) => {
    window.innerWidth = ancho
    const { container } = render(<ComoSeCalcula nombreEmpresa="San Javucho" />)
    expect(await violacionesAxe(container)).toEqual([])
  })
})
