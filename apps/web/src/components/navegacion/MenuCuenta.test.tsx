import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const useGetIdentity = vi.hoisted(() => vi.fn())
const useLogout = vi.hoisted(() => vi.fn())
const cerrarSesion = vi.hoisted(() => vi.fn())
const maybeSingle = vi.hoisted(() => vi.fn())
const eq = vi.hoisted(() => vi.fn(() => ({ maybeSingle })))
const select = vi.hoisted(() => vi.fn(() => ({ eq })))
const from = vi.hoisted(() => vi.fn(() => ({ select })))
const createSignedUrl = vi.hoisted(() => vi.fn())
const storageFrom = vi.hoisted(() => vi.fn(() => ({ createSignedUrl })))

vi.mock('@refinedev/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@refinedev/core')>()),
  useGetIdentity,
  useLogout,
}))
vi.mock('../../lib/supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/supabase')>()
  return { ...actual, supabaseClient: { ...actual.supabaseClient, from, storage: { ...actual.supabaseClient.storage, from: storageFrom } } }
})

import { MenuCuenta } from './MenuCuenta'

describe('MenuCuenta', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    maybeSingle.mockResolvedValue({ data: null, error: null })
    createSignedUrl.mockResolvedValue({ data: null })
    useLogout.mockReturnValue({ mutate: cerrarSesion })
  })

  it('no renderiza nada sin identidad', () => {
    useGetIdentity.mockReturnValue({ data: undefined, isLoading: true })

    render(<MemoryRouter><MenuCuenta /></MemoryRouter>)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('identifica la sesión vigente por email cuando no hay perfil completado', () => {
    useGetIdentity.mockReturnValue({ data: { id: 'user-1', email: 'persona@example.com' }, isLoading: false })

    render(<MemoryRouter><MenuCuenta /></MemoryRouter>)

    expect(screen.getByRole('button', { name: /persona@example.com/ })).toBeInTheDocument()
  })

  it('muestra nombre y apellido del perfil propio cuando están disponibles', async () => {
    maybeSingle.mockResolvedValue({ data: { nombre: 'Ada', apellido: 'Lovelace' }, error: null })
    useGetIdentity.mockReturnValue({ data: { id: 'user-1', email: 'persona@example.com' }, isLoading: false })

    render(<MemoryRouter><MenuCuenta /></MemoryRouter>)

    expect(await screen.findByRole('button', { name: /Ada Lovelace/ })).toBeInTheDocument()
    expect(from).toHaveBeenCalledWith('perfiles_usuario')
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('ofrece Perfil, Cambiar contraseña, Cambiar correo y Salir en un único menú', () => {
    useGetIdentity.mockReturnValue({ data: { id: 'user-1', email: 'persona@example.com' }, isLoading: false })

    render(<MemoryRouter><MenuCuenta /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByRole('menuitem', { name: /^Perfil/ })).toHaveAttribute('href', '/cuenta/perfil')
    expect(screen.getByRole('menuitem', { name: /Cambiar contraseña/ })).toHaveAttribute('href', '/cuenta/cambiar-contrasena')
    expect(screen.getByRole('menuitem', { name: /Cambiar correo electrónico/ })).toHaveAttribute('href', '/cuenta/cambiar-correo')

    fireEvent.click(screen.getByRole('menuitem', { name: /Salir/ }))
    expect(cerrarSesion).toHaveBeenCalled()
  })
})
