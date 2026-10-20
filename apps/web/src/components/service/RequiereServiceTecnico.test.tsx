import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useFeatureHabilitada: vi.fn(),
  useNivelSeccion: vi.fn(),
  useIsSuperadmin: vi.fn(),
}))

vi.mock('../../hooks/useFeatureHabilitada', () => ({ useFeatureHabilitada: mocks.useFeatureHabilitada }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/useIsSuperadmin', () => ({ useIsSuperadmin: mocks.useIsSuperadmin }))
vi.mock('../../hooks/useOrganizacionDeTrabajo', () => ({ useOrganizacionDeTrabajo: () => ({ organizacionId: null, isLoading: false }) }))
vi.mock('../../lib/supabase', () => ({
  supabaseClient: { auth: { getUser: async () => ({ data: { user: null } }) } },
}))
vi.mock('../../pages/acceso-restringido/AccesoRestringido', () => ({
  AccesoRestringido: ({ seccion }: { seccion: string }) => <p>Acceso restringido a {seccion}</p>,
}))

import { RequiereServiceTecnico } from './RequiereServiceTecnico'

const abrir = () => render(<RequiereServiceTecnico><p>Contenido de Service</p></RequiereServiceTecnico>)

describe('RequiereServiceTecnico', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useIsSuperadmin.mockReturnValue({ isSuperadmin: false, isLoading: false })
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.useFeatureHabilitada.mockReturnValue({ habilitada: true, isLoading: false })
  })

  it('muestra el contenido con acceso a la sección y la funcionalidad habilitada', () => {
    abrir()
    expect(screen.getByText('Contenido de Service')).toBeInTheDocument()
  })

  it('con solo lectura también abre (RLS decide la escritura)', () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    abrir()
    expect(screen.getByText('Contenido de Service')).toBeInTheDocument()
  })

  it('sin la funcionalidad habilitada muestra «Acceso restringido» y no monta el contenido', () => {
    mocks.useFeatureHabilitada.mockReturnValue({ habilitada: false, isLoading: false })
    abrir()
    expect(screen.getByText('Acceso restringido a Service técnico')).toBeInTheDocument()
    expect(screen.queryByText('Contenido de Service')).not.toBeInTheDocument()
  })

  it('mientras resuelve la funcionalidad no monta el contenido', () => {
    mocks.useFeatureHabilitada.mockReturnValue({ habilitada: null, isLoading: true })
    abrir()
    expect(screen.queryByText('Contenido de Service')).not.toBeInTheDocument()
  })

  it('sin permiso en la sección no monta el contenido ni consulta datos', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'ninguno', isLoading: false })
    abrir()
    expect(screen.queryByText('Contenido de Service')).not.toBeInTheDocument()
    expect(await screen.findByText(/Acceso restringido a/)).toBeInTheDocument()
  })
})
