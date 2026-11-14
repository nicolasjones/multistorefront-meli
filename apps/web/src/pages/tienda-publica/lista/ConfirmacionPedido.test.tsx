import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { ANCHOS_TIENDA, fijarAncho } from '../../../test/ancho'
import { violacionesAxe } from '../../../test/axe'
import { ConfirmacionPedido } from './ConfirmacionPedido'

const montar = (conCuenta: boolean) => render(<MemoryRouter><ConfirmacionPedido conCuenta={conCuenta} /></MemoryRouter>)

// MSF-176 · B1 · P-5.
describe('ConfirmacionPedido', () => {
  it('«Recibimos tu pedido… No se cobró nada.» con el foco en el título y role status', () => {
    montar(false)
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Recibimos tu pedido' })).toHaveFocus()
    expect(screen.getByText('Te vamos a responder para confirmar disponibilidad y precio. No se cobró nada.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Seguir viendo productos' })).toHaveAttribute('href', '/catalogo')
    expect(screen.queryByRole('link', { name: 'Ir a Mi cuenta' })).not.toBeInTheDocument()
  })

  it('con cuenta activa suma «Ir a Mi cuenta»', () => {
    montar(true)
    expect(screen.getByRole('link', { name: 'Ir a Mi cuenta' })).toHaveAttribute('href', '/mi-cuenta')
  })

  describe.each(ANCHOS_TIENDA)('a %i px', (ancho) => {
    it.each([false, true])('sin violaciones de axe (con cuenta: %s)', async (conCuenta) => {
      fijarAncho(ancho)
      const { container } = montar(conCuenta)
      expect(await violacionesAxe(container)).toEqual([])
    })
  })
})
