import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ leer: vi.fn() }))
vi.mock('../../../lib/inicio', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../lib/inicio')>()), leerConsultasNuevas: mocks.leer }))
vi.mock('../../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: { id: 'org-1' } }) }))
vi.mock('../../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: () => ({ empresaActivaId: 'e1', isLoading: false }) }))

import { TarjetaConsultas } from '../TarjetaConsultas'

describe('Tarjeta de consultas (FR-005)', () => {
  beforeEach(() => mocks.leer.mockReset())

  it('cuenta las consultas nuevas de la empresa activa y enlaza a la bandeja', async () => {
    mocks.leer.mockResolvedValue(4)
    render(<MemoryRouter><TarjetaConsultas /></MemoryRouter>)
    expect(await screen.findByText('4 consultas esperan atención')).toBeInTheDocument()
    expect(mocks.leer).toHaveBeenCalledWith('e1')
    expect(screen.getByRole('link', { name: 'Abrir consultas' })).toHaveAttribute('href', '/consultas')
  })

  it('con una sola consulta usa el singular', async () => {
    mocks.leer.mockResolvedValue(1)
    render(<MemoryRouter><TarjetaConsultas /></MemoryRouter>)
    expect(await screen.findByText('1 consulta espera atención')).toBeInTheDocument()
  })
})
