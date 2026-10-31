import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ stock: vi.fn(), consultas: vi.fn() }))
vi.mock('../../../lib/inicio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/inicio')>()),
  leerConteoStock: mocks.stock,
  leerConsultasNuevas: mocks.consultas,
}))
vi.mock('../../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: { id: 'org-1' } }) }))
vi.mock('../../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: () => ({ empresaActivaId: null, isLoading: false }) }))

import { TarjetaConsultas } from '../TarjetaConsultas'
import { TarjetaStock } from '../TarjetaStock'

describe('Estados por tarjeta (FR-008, SC-005)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('mientras carga muestra el estado de carga', () => {
    mocks.stock.mockReturnValue(new Promise(() => {}))
    render(<MemoryRouter><TarjetaStock /></MemoryRouter>)
    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
  })

  it('una tarjeta que falla muestra su error y las demás siguen funcionando', async () => {
    mocks.stock.mockRejectedValue(new Error('boom'))
    mocks.consultas.mockResolvedValue(2)
    render(<MemoryRouter><TarjetaStock /><TarjetaConsultas /></MemoryRouter>)
    expect(await screen.findByText('No pudimos cargar este dato')).toBeInTheDocument()
    expect(await screen.findByText('2 consultas esperan atención')).toBeInTheDocument()
    expect(screen.getAllByText('No pudimos cargar este dato')).toHaveLength(1)
  })
})
