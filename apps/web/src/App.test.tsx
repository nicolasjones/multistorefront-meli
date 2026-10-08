import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const useGetIdentity = vi.hoisted(() => vi.fn())
const maybeSingle = vi.hoisted(() => vi.fn())
const eq = vi.hoisted(() => vi.fn(() => ({ maybeSingle })))
const select = vi.hoisted(() => vi.fn(() => ({ eq })))
const from = vi.hoisted(() => vi.fn(() => ({ select })))
const createSignedUrl = vi.hoisted(() => vi.fn())
const storageFrom = vi.hoisted(() => vi.fn(() => ({ createSignedUrl })))

vi.mock('@refinedev/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@refinedev/core')>()),
  useGetIdentity,
}))

// Solo se sobrescriben `from` y `storage.from`; el resto del módulo real
// (incluido `auth`) queda intacto para no romper authProvider ni el test que
// renderiza <App /> completo sin sesión.
vi.mock('./lib/supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/supabase')>()
  return {
    ...actual,
    supabaseClient: { ...actual.supabaseClient, from, storage: { ...actual.supabaseClient.storage, from: storageFrom } },
  }
})

import App, { IndicadorSesionActiva } from './App'

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    maybeSingle.mockResolvedValue({ data: null, error: null })
    createSignedUrl.mockResolvedValue({ data: null })
  })

  it('redirects an unauthenticated visitor to the login screen', async () => {
    render(<App />)

    // i18nProvider traduce el título default de AuthPage al castellano —
    // ver apps/web/src/providers/i18nProvider.ts.
    expect(
      await screen.findByRole('heading', { name: /Iniciar sesión/i }),
    ).toBeInTheDocument()
  })

  it('identifica la sesion vigente y ofrece un acceso al perfil', () => {
    useGetIdentity.mockReturnValue({
      data: { id: 'user-1', email: 'persona@example.com' },
      isLoading: false,
    })

    render(
      <MemoryRouter>
        <IndicadorSesionActiva />
      </MemoryRouter>,
    )

    expect(screen.getByText(/Logueado como/)).toHaveTextContent('persona@example.com')
    expect(screen.getByRole('link', { name: 'Ver mi perfil' })).toHaveAttribute('href', '/cuenta/perfil')
  })

  it('muestra nombre y apellido del perfil propio cuando estan disponibles', async () => {
    maybeSingle.mockResolvedValue({ data: { nombre: 'Ada', apellido: 'Lovelace' }, error: null })
    useGetIdentity.mockReturnValue({
      data: { id: 'user-1', email: 'persona@example.com' },
      isLoading: false,
    })

    render(
      <MemoryRouter>
        <IndicadorSesionActiva />
      </MemoryRouter>,
    )

    expect(await screen.findByText(/Logueado como/)).toHaveTextContent('Ada Lovelace')
    expect(screen.queryByText('persona@example.com')).not.toBeInTheDocument()
    expect(from).toHaveBeenCalledWith('perfiles_usuario')
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('no conserva la identidad anterior despues de cerrar sesion', () => {
    useGetIdentity.mockReturnValue({ data: { id: 'user-1', email: 'persona@example.com' }, isLoading: false })
    const { rerender } = render(
      <MemoryRouter>
        <IndicadorSesionActiva />
      </MemoryRouter>,
    )
    expect(screen.getByText('persona@example.com')).toBeInTheDocument()

    useGetIdentity.mockReturnValue({ data: null, isLoading: false })
    rerender(
      <MemoryRouter>
        <IndicadorSesionActiva />
      </MemoryRouter>,
    )

    expect(screen.queryByText('persona@example.com')).not.toBeInTheDocument()
    expect(screen.queryByText(/Logueado como/)).not.toBeInTheDocument()
  })
})
