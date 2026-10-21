// Spec 022: la lista agrupa evidencias por épica y muestra el vacío sin manifiesto.
import { MemoryRouter } from 'react-router'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ download: vi.fn() }))

vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: () => ({ puedeEscribir: true, isLoading: false }) }))
vi.mock('../../hooks/useOrganizacionDeTrabajo', () => ({ useOrganizacionDeTrabajo: () => ({ organizacionId: 'org-1', isLoading: false }) }))
vi.mock('../../lib/supabase', () => ({
  supabaseClient: { storage: { from: () => ({ download: mocks.download }) } },
}))

import { CoberturaList } from './list'

const manifiesto = {
  run_id: 'r1',
  fecha: '2026-10-20T00:00:00Z',
  modo: 'on',
  evidencias: [
    {
      epica: 'MSF-136', epicaNombre: 'MSF-136 — Stock', spec: 's/stock', specTitulo: 'Stock movimientos',
      items: [{ id: 'T021', hecho: true, texto: 'E2E stock', ambiguo: false }],
      test: '[MSF-136:T021] e2e', archivo: 'e2e/s.e2e.ts', estado: 'pasado', video: 't1/video.webm',
    },
  ],
  huerfanos: [],
  sin_cubrir: [],
}

describe('CoberturaList', () => {
  it('agrupa por épica con conteos', async () => {
    mocks.download.mockResolvedValue({ data: { text: async () => JSON.stringify(manifiesto) }, error: null })
    render(<MemoryRouter><CoberturaList /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('MSF-136 — Stock')).toBeTruthy())
    expect(screen.getByText(/1 historia · 1 ítem · 1 video/).textContent).toBeTruthy()
  })

  it('muestra el vacío con instrucciones si no hay manifiesto', async () => {
    mocks.download.mockResolvedValue({ data: null, error: { message: 'no existe' } })
    render(<MemoryRouter><CoberturaList /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText(/Todavía no hay manifiesto de cobertura/).textContent).toBeTruthy())
  })
})
