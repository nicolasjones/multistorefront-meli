import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ puedeEscribir: vi.fn() }))

vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: mocks.puedeEscribir }))
vi.mock('../../hooks/useOrganizacionDeTrabajo', () => ({ useOrganizacionDeTrabajo: () => ({ organizacionId: 'o-1', isLoading: false }) }))
vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) }),
  },
}))

import { EjecucionList } from './list'

describe('Ejecuciones: acceso a Importar historial', () => {
  beforeEach(() => vi.clearAllMocks())

  it('un administrador ve el botón «Importar historial»', () => {
    mocks.puedeEscribir.mockReturnValue({ puedeEscribir: true, isLoading: false })
    render(<MemoryRouter><EjecucionList /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Importar historial' })).toHaveAttribute('href', '/historial/importar')
  })

  it('quien no es administrador no ve el botón ni la pantalla', () => {
    mocks.puedeEscribir.mockReturnValue({ puedeEscribir: false, isLoading: false })
    render(<MemoryRouter><EjecucionList /></MemoryRouter>)
    expect(screen.queryByRole('link', { name: 'Importar historial' })).not.toBeInTheDocument()
    expect(screen.getByText(/Solo un administrador/)).toBeInTheDocument()
  })
})
