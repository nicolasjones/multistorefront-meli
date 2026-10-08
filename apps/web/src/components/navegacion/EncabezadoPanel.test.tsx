import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const useGetIdentity = vi.hoisted(() => vi.fn())
const useLogout = vi.hoisted(() => vi.fn())
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

import { EncabezadoPanel } from './EncabezadoPanel'

// Pedido en vivo: el menú de cuenta pasa del pie del sider a la esquina
// superior derecha del header, fijo arriba de todo. Este test cubre la
// composición (hamburguesa a la izquierda, cuenta a la derecha del mismo
// Toolbar) — el detalle de MenuCuenta ya está cubierto en su propio test.
describe('EncabezadoPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    maybeSingle.mockResolvedValue({ data: null, error: null })
    createSignedUrl.mockResolvedValue({ data: null })
    useLogout.mockReturnValue({ mutate: vi.fn() })
  })

  it('muestra el toggle del sider y la cuenta en el mismo encabezado', () => {
    useGetIdentity.mockReturnValue({ data: { id: 'user-1', email: 'persona@example.com' }, isLoading: false })

    render(<MemoryRouter><EncabezadoPanel /></MemoryRouter>)

    expect(screen.getByRole('button', { name: 'open drawer' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /persona@example.com/ })).toBeInTheDocument()
  })

  it('no revienta si todavía no hay identidad resuelta', () => {
    useGetIdentity.mockReturnValue({ data: undefined, isLoading: true })

    render(<MemoryRouter><EncabezadoPanel /></MemoryRouter>)

    expect(screen.getByRole('button', { name: 'open drawer' })).toBeInTheDocument()
  })
})
