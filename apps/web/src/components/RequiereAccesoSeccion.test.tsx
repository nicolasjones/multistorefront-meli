import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RequiereAccesoSeccion } from './RequiereAccesoSeccion'

const mocks = vi.hoisted(() => ({
  useIsSuperadmin: vi.fn(),
  useNivelSeccion: vi.fn(),
  maybeSingle: vi.fn(),
  eq: vi.fn(),
  getUser: vi.fn(),
}))

vi.mock('../hooks/useIsSuperadmin', () => ({ useIsSuperadmin: mocks.useIsSuperadmin }))
vi.mock('../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../lib/supabase', () => ({
  supabaseClient: {
    auth: { getUser: mocks.getUser },
    from: () => ({ select: () => ({ eq: mocks.eq }) }),
  },
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
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    mocks.eq.mockReturnValue({ maybeSingle: mocks.maybeSingle })
    mocks.maybeSingle.mockResolvedValue({ data: { rol_id: 'operador' }, error: null })
  })

  it('sin acceso muestra la pantalla con rol y sección reales y no monta la sección', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'ninguno', isLoading: false })
    const hijo = renderizar()

    expect(await screen.findByText('Tu rol (Operador) no incluye Clientes. Pedile acceso a un administrador.')).toBeInTheDocument()
    expect(screen.queryByText('Contenido de la sección')).not.toBeInTheDocument()
    expect(hijo).not.toHaveBeenCalled()
    expect(mocks.eq).toHaveBeenCalledWith('user_id', 'u1')
    expect(screen.getByRole('alert')).toHaveTextContent('Sección no disponible para tu rol')
  })

  it.each(['lectura', 'edicion'] as const)('con nivel %s muestra la sección', (nivel) => {
    mocks.useNivelSeccion.mockReturnValue({ nivel, isLoading: false })
    renderizar()

    expect(screen.getByText('Contenido de la sección')).toBeInTheDocument()
    expect(mocks.maybeSingle).not.toHaveBeenCalled()
  })

  it('mientras carga no muestra ni la sección ni la pantalla', () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: null, isLoading: true })
    const hijo = renderizar()

    expect(hijo).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('el superadmin no ve la pantalla restringida', async () => {
    mocks.useIsSuperadmin.mockReturnValue({ isSuperadmin: true, isLoading: false })
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'ninguno', isLoading: false })
    renderizar()

    await waitFor(() => expect(screen.getByText('Contenido de la sección')).toBeInTheDocument())
  })

  const TEXTO_GENERICO = 'Tu rol (actual) no incluye Clientes. Pedile acceso a un administrador.'

  it.each([
    ['la consulta devuelve error', () => mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: 'x' } })],
    ['la consulta se rechaza', () => mocks.maybeSingle.mockRejectedValue(new Error('red'))],
    ['el rol es desconocido', () => mocks.maybeSingle.mockResolvedValue({ data: { rol_id: 'nuevo' }, error: null })],
  ])('cuando %s muestra la pantalla con rol genérico, no una pantalla en blanco', async (_caso, preparar) => {
    preparar()
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'ninguno', isLoading: false })
    renderizar()

    expect(await screen.findByText(TEXTO_GENERICO)).toBeInTheDocument()
  })

  it('con nivel nulo tras cargar (error de permisos) deniega en vez de mostrar la sección', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: null, isLoading: false })
    const hijo = renderizar()

    expect(await screen.findByText(TEXTO_GENERICO.replace('actual', 'Operador'))).toBeInTheDocument()
    expect(hijo).not.toHaveBeenCalled()
  })
})
