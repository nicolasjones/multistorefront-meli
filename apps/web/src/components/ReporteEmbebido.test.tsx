import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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
})
