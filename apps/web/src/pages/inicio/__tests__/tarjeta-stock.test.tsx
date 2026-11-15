import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ leer: vi.fn() }))
vi.mock('../../../lib/inicio', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../lib/inicio')>()), leerConteoStock: mocks.leer }))
vi.mock('../../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: { id: 'org-1' } }) }))

import { TarjetaStock } from '../TarjetaStock'

describe('Tarjeta de stock (FR-004)', () => {
  beforeEach(() => mocks.leer.mockReset())

  it('muestra sin stock y stock bajo con enlace a Stock', async () => {
    mocks.leer.mockResolvedValue({ sinStock: 3, stockBajo: 1, total: 20 })
    render(<MemoryRouter><TarjetaStock /></MemoryRouter>)
    expect(await screen.findByText('3 productos sin stock')).toBeInTheDocument()
    expect(screen.getByText('1 producto con stock bajo')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver stock' })).toHaveAttribute('href', '/stock')
  })
})
