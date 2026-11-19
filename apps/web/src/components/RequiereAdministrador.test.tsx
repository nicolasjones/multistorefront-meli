import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ usePuedeEscribir: vi.fn() }))
vi.mock('../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: mocks.usePuedeEscribir }))

import { RequiereAdministrador } from './RequiereAdministrador'

const abrir = () => render(
  <MemoryRouter>
    <RequiereAdministrador seccion="Importar historial"><p>Contenido</p></RequiereAdministrador>
  </MemoryRouter>,
)

describe('RequiereAdministrador', () => {
  beforeEach(() => vi.clearAllMocks())

  it('monta el contenido para un administrador', () => {
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: true, isLoading: false })
    abrir()
    expect(screen.getByText('Contenido')).toBeInTheDocument()
  })

  it('a quien no es administrador le dice el motivo y no monta el contenido', () => {
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: false, isLoading: false })
    abrir()
    expect(screen.getByText('Solo para administradores')).toBeInTheDocument()
    expect(screen.queryByText('Contenido')).not.toBeInTheDocument()
  })

  it('mientras resuelve el permiso no monta el contenido', () => {
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: null, isLoading: true })
    abrir()
    expect(screen.queryByText('Contenido')).not.toBeInTheDocument()
    expect(screen.queryByText('Solo para administradores')).not.toBeInTheDocument()
  })
})
