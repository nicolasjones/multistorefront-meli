import { render, screen, within } from '@testing-library/react'
import { violacionesAxe } from '../../../test/axe'
import { describe, expect, it } from 'vitest'
import { BloqueLegal } from './PieLegal'

const completo = {
  razonSocial: 'Uno A S.A.',
  cuit: '30711111114',
  direccion: 'Calle 1 100',
  enlaces: [{ titulo: 'Arrepentimiento', url: 'https://uno.ejemplo.com/a' }, { titulo: 'Términos', url: 'https://uno.ejemplo.com/t' }],
}

describe('BloqueLegal (FR-032)', () => {
  it('muestra razón social y CUIT formateado, dirección y enlaces en pestaña nueva', async () => {
    const { container } = render(<BloqueLegal legal={completo} />)
    const bloque = screen.getByRole('region', { name: 'Información legal' })
    expect(within(bloque).getByText('Uno A S.A. · CUIT 30-71111111-4')).toBeInTheDocument()
    expect(within(bloque).getByText('Calle 1 100')).toBeInTheDocument()
    const enlaces = within(bloque).getAllByRole('link')
    expect(enlaces.map((e) => e.textContent)).toEqual(['Arrepentimiento', 'Términos'])
    for (const e of enlaces) {
      expect(e).toHaveAttribute('target', '_blank')
      expect(e).toHaveAttribute('rel', 'noopener noreferrer')
    }
    expect(await violacionesAxe(container)).toEqual([])
  })

  it('omite los datos ausentes', () => {
    render(<BloqueLegal legal={{ razonSocial: 'Solo S.R.L.', cuit: null, direccion: null, enlaces: [] }} />)
    expect(screen.getByText('Solo S.R.L.')).toBeInTheDocument()
    expect(screen.queryByText(/CUIT/)).not.toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('sin datos (o sin respuesta) el bloque no aparece', () => {
    const { container, rerender } = render(<BloqueLegal legal={{ razonSocial: null, cuit: null, direccion: null, enlaces: [] }} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<BloqueLegal legal={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('el texto con HTML queda literal', () => {
    const { container } = render(<BloqueLegal legal={{ ...completo, razonSocial: '<b>Mala</b> S.A.', enlaces: [] }} />)
    expect(container.querySelector('b')).toBeNull()
    expect(screen.getByText(/<b>Mala<\/b> S\.A\./)).toBeInTheDocument()
  })
})
