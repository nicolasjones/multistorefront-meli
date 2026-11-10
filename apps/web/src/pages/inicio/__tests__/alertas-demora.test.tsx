import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ alertas: vi.fn(), calculo: vi.fn() }))
vi.mock('../../../lib/inicio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/inicio')>()),
  leerAlertasInicio: mocks.alertas,
  leerUltimoCalculoAlertas: mocks.calculo,
}))
vi.mock('../../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: { id: 'org-1' } }) }))
vi.mock('../../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: () => ({ empresaActivaId: null, isLoading: false, empresas: [] }) }))

import { AlertasInicio } from '../AlertasInicio'
import { UMBRAL_DEMORA_ALERTAS_MS, alertasDemoradas } from '../../../lib/inicio'

const hace = (ms: number) => new Date(Date.now() - ms).toISOString()

describe('Aviso de demora de las alertas (FR-024)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.alertas.mockResolvedValue([])
  })

  it('el umbral es de 1 hora', () => {
    const ahora = new Date()
    expect(UMBRAL_DEMORA_ALERTAS_MS).toBe(3_600_000)
    expect(alertasDemoradas(hace(59 * 60_000), ahora)).toBe(false)
    expect(alertasDemoradas(hace(61 * 60_000), ahora)).toBe(true)
    expect(alertasDemoradas(null, ahora)).toBe(true)
  })

  it('con un cálculo reciente no avisa demora', async () => {
    mocks.calculo.mockResolvedValue(hace(5 * 60_000))
    render(<MemoryRouter><AlertasInicio /></MemoryRouter>)
    await screen.findByText('Sin alertas')
    expect(screen.queryByText(/pueden estar desactualizadas/)).not.toBeInTheDocument()
  })

  it('con un cálculo de hace más de una hora avisa la demora con la hora del último cálculo', async () => {
    const viejo = hace(3 * 3_600_000)
    mocks.calculo.mockResolvedValue(viejo)
    render(<MemoryRouter><AlertasInicio /></MemoryRouter>)
    const aviso = await screen.findByText(/Las alertas se calcularon por última vez a las .+ y pueden estar desactualizadas\./)
    expect(aviso).toBeInTheDocument()
    expect(aviso.textContent).toMatch(/\d{2}:\d{2}/)
  })

  it('si nunca se calcularon avisa que todavía no hay cálculo y no afirma «Sin alertas»', async () => {
    mocks.calculo.mockResolvedValue(null)
    render(<MemoryRouter><AlertasInicio /></MemoryRouter>)
    expect(await screen.findByText('Todavía no se calcularon las alertas.')).toBeInTheDocument()
    expect(screen.queryByText('Sin alertas')).not.toBeInTheDocument()
  })
})
