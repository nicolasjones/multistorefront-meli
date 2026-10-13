import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RequiereAccesoSeccion } from './RequiereAccesoSeccion'

const mocks = vi.hoisted(() => ({
  useIsSuperadmin: vi.fn(),
  useNivelSeccion: vi.fn(),
  maybeSingle: vi.fn(),
}))

vi.mock('../hooks/useIsSuperadmin', () => ({ useIsSuperadmin: mocks.useIsSuperadmin }))
vi.mock('../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../lib/supabase', () => ({
  supabaseClient: { from: () => ({ select: () => ({ maybeSingle: mocks.maybeSingle }) }) },
}))

function renderizar(hijo = vi.fn(() => <p>Contenido de la sección</p>)) {
  const Hijo = hijo
  render(
    <MemoryRouter>
      <RequiereAccesoSeccion seccion="clientes">
        <Hijo />
      </RequiereAccesoSeccion>
    </MemoryRouter>,
  )
  return hijo
}

describe('RequiereAccesoSeccion (F-ROL-03, FR-008)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useIsSuperadmin.mockReturnValue({ isSuperadmin: false, isLoading: false })
    mocks.maybeSingle.mockResolvedValue({ data: { rol_id: 'operador' } })
  })

  it('sin acceso muestra la pantalla con rol y sección reales y no monta la sección', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'ninguno', isLoading: false })
    const hijo = renderizar()

    expect(await screen.findByText('Tu rol (Operador) no incluye Clientes. Pedile acceso a un administrador.')).toBeInTheDocument()
    expect(screen.queryByText('Contenido de la sección')).not.toBeInTheDocument()
    expect(hijo).not.toHaveBeenCalled()
  })

  it.each(['lectura', 'edicion'] as const)('con nivel %s muestra la sección', (nivel) => {
    mocks.useNivelSeccion.mockReturnValue({ nivel, isLoading: false })
    renderizar()

    expect(screen.getByText('Contenido de la sección')).toBeInTheDocument()
  })

  it('mientras carga no muestra ni la sección ni la pantalla', () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: null, isLoading: true })
    const hijo = renderizar()

    expect(hijo).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('el superadmin no ve la pantalla restringida', async () => {
    mocks.useIsSuperadmin.mockReturnValue({ isSuperadmin: true, isLoading: false })
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'ninguno', isLoading: false })
    renderizar()

    await waitFor(() => expect(screen.getByText('Contenido de la sección')).toBeInTheDocument())
  })
})
