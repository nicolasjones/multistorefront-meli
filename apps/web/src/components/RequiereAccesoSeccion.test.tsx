import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RequiereAccesoSeccion } from './RequiereAccesoSeccion'

const mocks = vi.hoisted(() => ({
  useIsSuperadmin: vi.fn(),
  useNivelSeccion: vi.fn(),
  useOrganizacionDeTrabajo: vi.fn(),
  maybeSingle: vi.fn(),
  eq: vi.fn(),
  getUser: vi.fn(),
}))

vi.mock('../hooks/useIsSuperadmin', () => ({ useIsSuperadmin: mocks.useIsSuperadmin }))
vi.mock('../hooks/useOrganizacionDeTrabajo', () => ({ useOrganizacionDeTrabajo: mocks.useOrganizacionDeTrabajo }))
vi.mock('../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../lib/supabase', () => ({
  supabaseClient: {
    auth: { getUser: mocks.getUser },
    from: () => ({ select: () => ({ eq: mocks.eq }) }),
  },
}))

function renderizar(hijo = vi.fn(() => <p>Contenido de la sección</p>), seccion = 'clientes') {
  const Hijo = hijo
  render(
    <MemoryRouter>
      <RequiereAccesoSeccion seccion={seccion}>
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
    mocks.useOrganizacionDeTrabajo.mockReturnValue({ organizacionId: 'org-activa', isLoading: false })
    // select().eq('user_id').eq('organizacion_id').maybeSingle()
    mocks.eq.mockReturnValue({ eq: mocks.eq, maybeSingle: mocks.maybeSingle })
    mocks.maybeSingle.mockResolvedValue({ data: { rol_id: 'operador' }, error: null })
  })

  it('sin acceso muestra la pantalla con rol y sección reales y no monta la sección', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'ninguno', isLoading: false })
    const hijo = renderizar()

    expect(await screen.findByText('Tu rol (Operador) no incluye Clientes. Pedile acceso a un administrador.')).toBeInTheDocument()
    expect(screen.queryByText('Contenido de la sección')).not.toBeInTheDocument()
    expect(hijo).not.toHaveBeenCalled()
    expect(mocks.eq).toHaveBeenCalledWith('user_id', 'u1')
    expect(mocks.eq).toHaveBeenCalledWith('organizacion_id', 'org-activa')
    expect(screen.getByRole('alert')).toHaveTextContent('Sección no disponible para tu rol')
    // F-ROL-05: la pantalla recibe la clave de la sección, así que ofrece «Solicitar acceso».
    expect(screen.getByRole('button', { name: 'Solicitar acceso' })).toBeInTheDocument()
  })

  it.each(['lectura', 'edicion'] as const)('con nivel %s muestra la sección', (nivel) => {
    mocks.useNivelSeccion.mockReturnValue({ nivel, isLoading: false })
    renderizar()

    expect(screen.getByText('Contenido de la sección')).toBeInTheDocument()
    expect(mocks.maybeSingle).not.toHaveBeenCalled()
  })

  it('protege /productos: sin acceso a la sección productos no monta el alta', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'ninguno', isLoading: false })
    const hijo = renderizar(undefined, 'productos')

    expect(await screen.findByRole('alert')).toHaveTextContent('Sección no disponible para tu rol')
    expect(hijo).not.toHaveBeenCalled()
    expect(mocks.useNivelSeccion).toHaveBeenCalledWith('productos')
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

  it('con varias membresías consulta el rol de la organización activa', async () => {
    mocks.useOrganizacionDeTrabajo.mockReturnValue({ organizacionId: 'org-b', isLoading: false })
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'ninguno', isLoading: false })
    renderizar()

    expect(await screen.findByText('Tu rol (Operador) no incluye Clientes. Pedile acceso a un administrador.')).toBeInTheDocument()
    expect(mocks.eq).toHaveBeenCalledWith('organizacion_id', 'org-b')
    expect(mocks.eq).not.toHaveBeenCalledWith('organizacion_id', 'org-activa')
  })

  it('espera a conocer la organización activa antes de consultar el rol', () => {
    mocks.useOrganizacionDeTrabajo.mockReturnValue({ organizacionId: null, isLoading: true })
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'ninguno', isLoading: false })
    const hijo = renderizar()

    expect(hijo).not.toHaveBeenCalled()
    expect(mocks.maybeSingle).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
