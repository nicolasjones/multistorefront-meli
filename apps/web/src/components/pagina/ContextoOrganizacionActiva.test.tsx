import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ useContextoPanel: vi.fn() }))
vi.mock('../../hooks/useContextoPanel', () => ({ useContextoPanel: mocks.useContextoPanel }))

import { ContextoOrganizacionActiva } from './ContextoOrganizacionActiva'

describe('ContextoOrganizacionActiva', () => {
  it('muestra el nombre de la organización activa (FR-006)', () => {
    mocks.useContextoPanel.mockReturnValue({ contexto: { organizacion_nombre: 'Acme' } })

    render(<ContextoOrganizacionActiva />)

    expect(screen.getByText('Organización: Acme')).toBeInTheDocument()
  })

  it('no renderiza nada sin una organización activa', () => {
    mocks.useContextoPanel.mockReturnValue({ contexto: { organizacion_nombre: null } })

    const { container } = render(<ContextoOrganizacionActiva />)

    expect(container).toBeEmptyDOMElement()
  })
})
