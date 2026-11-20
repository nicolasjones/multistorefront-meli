import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ consulta: vi.fn() }))
vi.mock('@refinedev/mui', () => ({ List: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('../../hooks/useIsSuperadmin', () => ({ useIsSuperadmin: () => ({ isSuperadmin: true, isLoading: false }) }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: { from: () => ({ select: () => mocks.consulta() }) } }))

import { IaList } from './list'

const abrir = () => render(<MemoryRouter><IaList /></MemoryRouter>)

describe('IaList', () => {
  beforeEach(() => vi.clearAllMocks())

  it('un fallo de la consulta se avisa con «Reintentar», no se muestra como lista vacía', async () => {
    mocks.consulta.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    abrir()
    expect(await screen.findByText('No pudimos cargar esta información.')).toBeInTheDocument()
    expect(screen.queryByText('Sin proveedores')).not.toBeInTheDocument()
    mocks.consulta.mockResolvedValueOnce({ data: [{ id: 'p-1', nombre: 'Proveedor Uno', habilitado: true }], error: null })
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(screen.getByText('Proveedor Uno')).toBeInTheDocument())
  })

  it('sin proveedores muestra el estado vacío', async () => {
    mocks.consulta.mockResolvedValue({ data: [], error: null })
    abrir()
    expect(await screen.findByText('Sin proveedores')).toBeInTheDocument()
  })
})
