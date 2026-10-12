import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { panelFixtures } from '../../test/fixtures/panel'

const useContextoPanel = vi.hoisted(() => vi.fn())
vi.mock('../../hooks/useContextoPanel', () => ({ useContextoPanel }))

import { SelectorEmpresa } from './SelectorEmpresa'

const contextoConEmpresa = { ...panelFixtures.miembro, organizacion_id: 'org-1', organizacion_nombre: 'Mundo JC' }

describe('SelectorEmpresa', () => {
  it('muestra la empresa activa sin opción de cambio si hay una sola', () => {
    useContextoPanel.mockReturnValue({ contexto: contextoConEmpresa, isLoading: false })
    render(<SelectorEmpresa />)

    const boton = screen.getByRole('button', { name: 'Empresa activa: Mundo JC' })
    expect(boton).not.toHaveAttribute('aria-haspopup')
    fireEvent.click(boton)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('con varias empresas lista y marca la activa', () => {
    useContextoPanel.mockReturnValue({ contexto: contextoConEmpresa, isLoading: false })
    render(<SelectorEmpresa empresas={[{ id: 'org-1', nombre: 'Mundo JC' }, { id: 'org-2', nombre: 'San Javucho' }]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Empresa activa: Mundo JC' }))
    expect(screen.getByRole('menuitem', { name: 'Mundo JC' })).toHaveClass('Mui-selected')
    expect(screen.getByRole('menuitem', { name: 'San Javucho' })).not.toHaveClass('Mui-selected')
  })

  it('no renderiza nada sin empresa activa', () => {
    useContextoPanel.mockReturnValue({ contexto: { ...contextoConEmpresa, organizacion_id: null, organizacion_nombre: null }, isLoading: false })
    const { container } = render(<SelectorEmpresa />)
    expect(container).toBeEmptyDOMElement()
  })
})
