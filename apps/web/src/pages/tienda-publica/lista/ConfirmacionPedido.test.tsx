import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { ANCHOS_TIENDA, fijarAncho } from '../../../test/ancho'
import { violacionesAxe } from '../../../test/axe'
import { ConfirmacionPedido } from './ConfirmacionPedido'

const montar = (conCuenta: boolean) => render(<MemoryRouter><ConfirmacionPedido conCuenta={conCuenta} /></MemoryRouter>)
const montarPresupuesto = (cambioElPrecio = false) =>
  render(<MemoryRouter><ConfirmacionPedido conCuenta presupuesto={{ numero: '00000012', totalConIva: 12500.5, cambioElPrecio }} /></MemoryRouter>)

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

  // MSF-176 · B2 · P-5 (FR-062).
  it('presupuesto: «Pedimos tu presupuesto Nº…», leyenda de que no es una compra, total y enlaces; foco en el título', () => {
    montarPresupuesto()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Pedimos tu presupuesto Nº 00000012' })).toHaveFocus()
    expect(screen.getByText('Es un presupuesto, no una compra: no reserva stock ni se cobró nada. Te vamos a responder para coordinar.')).toBeInTheDocument()
    expect(screen.getByText('Total con IVA: $ 12.500,50')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver en Mi cuenta' })).toHaveAttribute('href', '/mi-cuenta?seccion=compras')
    expect(screen.getByRole('link', { name: 'Seguir viendo productos' })).toHaveAttribute('href', '/catalogo')
    expect(screen.queryByText(/El precio cambió/)).not.toBeInTheDocument()
    expect(screen.queryByText('Recibimos tu pedido')).not.toBeInTheDocument()
  })

  it('presupuesto: si el total confirmado difiere del cotizado avisa «El precio cambió mientras armabas el presupuesto»', () => {
    montarPresupuesto(true)
    expect(screen.getByText('El precio cambió mientras armabas el presupuesto. Este es el total vigente.')).toBeInTheDocument()
  })

  describe.each(ANCHOS_TIENDA)('presupuesto a %i px', (ancho) => {
    it('sin violaciones de axe', async () => {
      fijarAncho(ancho)
      const { container } = montarPresupuesto(true)
      expect(await violacionesAxe(container)).toEqual([])
    })
  })
})
