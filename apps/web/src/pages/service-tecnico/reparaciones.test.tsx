import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ useNivelSeccion: vi.fn() }))

vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { ServicioReparaciones } from './reparaciones'

const abrir = () => render(<MemoryRouter><ServicioReparaciones /></MemoryRouter>)

describe('Service técnico · Reparaciones (FR-018)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
  })

  it('ofrece «Nueva reparación» y lleva a la ruta de alta', async () => {
    abrir()
    expect(screen.getByRole('heading', { name: 'Reparaciones' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Reparaciones' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Modelos' })).toHaveAttribute('href', '/service-tecnico/modelos')
    expect(screen.getByRole('link', { name: 'Nueva reparación' })).toHaveAttribute('href', '/service-tecnico/reparaciones/nueva')
    // El listado con tabla, KPIs y filtros es de MSF-199: acá solo el alta.
    expect(screen.getByText(/Cargá una reparación con «Nueva reparación»/)).toBeInTheDocument()
  })

  it('con solo lectura no ofrece crear y lo explica', () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    abrir()
    expect(screen.queryByRole('link', { name: 'Nueva reparación' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nueva reparación' })).not.toBeInTheDocument()
    expect(screen.getByText(/Tu rol puede consultar reparaciones, pero no crearlas/)).toBeInTheDocument()
  })
})
