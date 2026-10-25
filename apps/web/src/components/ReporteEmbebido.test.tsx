import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { embedDashboard } from '@superset-ui/embedded-sdk'
import { supabaseClient } from '../lib/supabase'
import { ReporteEmbebido } from './ReporteEmbebido'

// El SDK real intenta cargar un iframe de verdad — no hay señal en
// mockearlo más allá de confirmar que no se llama cuando la Edge Function
// ya falló (research.md #8, mismo criterio que el resto del repo).
vi.mock('@superset-ui/embedded-sdk', () => ({
  embedDashboard: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabaseClient: {
    auth: { getSession: vi.fn() },
    functions: { invoke: vi.fn() },
  },
}))

describe('ReporteEmbebido', () => {
  it('muestra el mensaje de no disponibilidad cuando la Edge Function devuelve 503', async () => {
    vi.mocked(supabaseClient.auth.getSession).mockResolvedValue({
      data: { session: { access_token: 'token-de-prueba' } },
      error: null,
    } as never)

    vi.mocked(supabaseClient.functions.invoke).mockResolvedValue({
      data: null,
      error: { message: 'analitica_no_disponible' },
    } as never)

    render(<ReporteEmbebido reporteId="reporte-1" />)

    expect(
      await screen.findByText('Analítica no disponible en este momento.'),
    ).toBeInTheDocument()
  })

  it('con alFallar, avisa el motivo en vez de dibujar su propio aviso: 403 → prohibido', async () => {
    vi.mocked(supabaseClient.auth.getSession).mockResolvedValue({
      data: { session: { access_token: 'token-de-prueba' } },
      error: null,
    } as never)
    vi.mocked(supabaseClient.functions.invoke).mockResolvedValue({
      data: null,
      error: { message: 'forbidden', context: { status: 403 } },
    } as never)
    const alFallar = vi.fn()

    render(<ReporteEmbebido reporteId="reporte-1" alFallar={alFallar} />)

    await waitFor(() => expect(alFallar).toHaveBeenCalledWith('prohibido'))
    expect(screen.queryByText('Analítica no disponible en este momento.')).not.toBeInTheDocument()
  })

  it('con alFallar, una falla de servicio (503) llega como no_disponible', async () => {
    vi.mocked(supabaseClient.auth.getSession).mockResolvedValue({
      data: { session: { access_token: 'token-de-prueba' } },
      error: null,
    } as never)
    vi.mocked(supabaseClient.functions.invoke).mockResolvedValue({
      data: null,
      error: { message: 'analitica_no_disponible', context: { status: 503 } },
    } as never)
    const alFallar = vi.fn()

    render(<ReporteEmbebido reporteId="reporte-1" alFallar={alFallar} />)

    await waitFor(() => expect(alFallar).toHaveBeenCalledWith('no_disponible'))
  })

  it('sin sesión avisa no_disponible y no pide token', async () => {
    vi.mocked(supabaseClient.functions.invoke).mockClear()
    vi.mocked(supabaseClient.auth.getSession).mockResolvedValue({ data: { session: null }, error: null } as never)
    const alFallar = vi.fn()

    render(<ReporteEmbebido reporteId="reporte-1" alFallar={alFallar} />)

    await waitFor(() => expect(alFallar).toHaveBeenCalledWith('no_disponible'))
    expect(supabaseClient.functions.invoke).not.toHaveBeenCalled()
  })

  it('pasa urlParams al embebido (filtro nativo inicial) y sin ellos no manda ninguno', async () => {
    vi.mocked(supabaseClient.auth.getSession).mockResolvedValue({
      data: { session: { access_token: 'token-de-prueba' } },
      error: null,
    } as never)
    vi.mocked(supabaseClient.functions.invoke).mockResolvedValue({
      data: { guest_token: 'g', dashboard_uuid: 'uuid', superset_url: 'http://superset' },
      error: null,
    } as never)
    vi.mocked(embedDashboard).mockResolvedValue(undefined as never)

    const { unmount } = render(<ReporteEmbebido reporteId="reporte-1" urlParams={{ native_filters: '(x:1)' }} />)
    await waitFor(() => expect(embedDashboard).toHaveBeenCalledTimes(1))
    expect(vi.mocked(embedDashboard).mock.calls[0][0].dashboardUiConfig).toEqual({
      hideTitle: true,
      urlParams: { native_filters: '(x:1)' },
    })
    unmount()

    render(<ReporteEmbebido reporteId="reporte-1" />)
    await waitFor(() => expect(embedDashboard).toHaveBeenCalledTimes(2))
    expect(vi.mocked(embedDashboard).mock.calls[1][0].dashboardUiConfig?.urlParams).toBeUndefined()
  })
})
