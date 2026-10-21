// Spec 023: el visor agrupa Componente → Épica, filtra y cae al manifiesto local.
import { MemoryRouter } from 'react-router'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ download: vi.fn() }))

vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: () => ({ puedeEscribir: true, isLoading: false }) }))
vi.mock('../../hooks/useOrganizacionDeTrabajo', () => ({ useOrganizacionDeTrabajo: () => ({ organizacionId: 'org-1', isLoading: false }) }))
vi.mock('../../lib/supabase', () => ({
  supabaseClient: { storage: { from: () => ({ download: mocks.download }) } },
}))

import { CoberturaList, resumirPorComponente } from './list'
import type { ManifiestoCobertura } from './tipos'

const manifiesto: ManifiestoCobertura = {
  run_id: 'r1',
  fecha: '2026-10-20T00:00:00Z',
  modo: 'on',
  evidencias: [
    {
      epica: 'MSF-119', epicaNombre: 'MSF-119 — Acceso', componente: 'Acceso', spec: 's/acceso',
      specTitulo: 'Acceso y organización',
      items: [
        { id: 'T020', hecho: true, texto: 'E2E de ingreso', ambiguo: false },
        { id: 'T021', hecho: true, texto: 'E2E de recuperación', ambiguo: false },
      ],
      test: '[MSF-119:T020, T021] recorrido', archivo: 'e2e/a.e2e.ts', estado: 'pasado', video: 't1/video.webm',
    },
    {
      epica: 'MSF-136', epicaNombre: 'MSF-136 — Stock', componente: 'Stock', spec: 's/stock',
      specTitulo: 'Stock movimientos',
      items: [{ id: 'T021', hecho: true, texto: 'E2E stock', ambiguo: false }],
      test: '[MSF-136:T021] e2e', archivo: 'e2e/s.e2e.ts', estado: 'fallido', video: null,
    },
  ],
  huerfanos: [],
  sin_cubrir: [
    { componente: 'Acceso', spec: 's/acceso', specTitulo: 'Acceso y organización', id: 'T022', hecho: false, texto: 'Alta de empresa' },
  ],
}

const responderBucket = (valor: ManifiestoCobertura) =>
  mocks.download.mockResolvedValue({ data: { text: async () => JSON.stringify(valor) }, error: null })

afterEach(() => {
  mocks.download.mockReset()
  vi.unstubAllGlobals()
})

describe('CoberturaList', () => {
  it('resume por componente con progreso real (sin_cubrir cuenta en el total)', () => {
    const componentes = resumirPorComponente(manifiesto)
    expect(componentes.map((c) => c.componente)).toEqual(['Acceso', 'Stock'])
    const acceso = componentes[0].epicas[0]
    expect(acceso).toMatchObject({ epica: 'MSF-119', historias: 1, cubiertos: 2, total: 3, videos: 1 })
    expect(componentes[1].epicas[0]).toMatchObject({ epica: 'MSF-136', cubiertos: 1, total: 1, fallidos: 1 })
  })

  it('agrupa por componente y muestra el progreso de cada épica', async () => {
    responderBucket(manifiesto)
    render(<MemoryRouter><CoberturaList /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('Acceso')).toBeTruthy())
    expect(screen.getByText('Stock')).toBeTruthy()
    expect(screen.getByText(/2 de 3 ítems con E2E \(67%\)/)).toBeTruthy()
  })

  it('filtra por estado fallido', async () => {
    const { filtrarComponentes } = await import('./list')
    const visibles = filtrarComponentes(manifiesto, resumirPorComponente(manifiesto), '', 'fallido')
    expect(visibles.map((c) => c.componente)).toEqual(['Stock'])
  })

  it('busca por texto de un ítem, no sólo por el nombre de la épica', async () => {
    const { filtrarComponentes } = await import('./list')
    const componentes = resumirPorComponente(manifiesto)
    expect(filtrarComponentes(manifiesto, componentes, 'alta de empresa', 'todos').map((c) => c.componente)).toEqual(['Acceso'])
    expect(filtrarComponentes(manifiesto, componentes, 'ingreso', 'todos').flatMap((c) => c.epicas.map((e) => e.epica))).toEqual(['MSF-119'])
    expect(filtrarComponentes(manifiesto, componentes, 'no existe', 'todos')).toEqual([])
  })

  it('cae al manifiesto local con insignia cuando el bucket no está configurado', async () => {
    mocks.download.mockResolvedValue({ data: null, error: { message: 'no existe' } })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => manifiesto })))
    render(<MemoryRouter><CoberturaList /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('Manifiesto local')).toBeTruthy())
    expect(screen.getByText('Acceso')).toBeTruthy()
  })

  it('muestra el vacío con instrucciones si no hay bucket ni manifiesto local', async () => {
    mocks.download.mockResolvedValue({ data: null, error: { message: 'no existe' } })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })))
    render(<MemoryRouter><CoberturaList /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText(/Todavía no hay manifiesto de cobertura/)).toBeTruthy())
  })
})
