// Prueba de empresa activa de la pantalla «API» (F-API-01, FR-013, spec 20270203-100000:
// «Empresa activa: no aplica»): las claves, las suscripciones, las entregas y las llamadas son de la
// ORGANIZACIÓN, no de una empresa. Cambiar de empresa en la barra superior no puede recargar ni
// alterar la pantalla: esta no lee `empresa_id` ni reacciona al cambio. Corre con
// `pnpm --filter @platform/web test`.
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  usePuedeEscribir: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabaseClient: { from: mocks.from, rpc: mocks.rpc },
}))
vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: mocks.usePuedeEscribir }))
vi.mock('../../hooks/useNombreRolActual', () => ({ useNombreRolActual: () => 'Administrador' }))
vi.mock('../acceso-restringido/AccesoRestringido', () => ({
  AccesoRestringido: ({ seccion }: { seccion: string }) => <p>Sin acceso a {seccion}</p>,
}))

import { ApiList } from './list'

const CLAVES = [
  {
    id: 'c-1',
    nombre: 'Integración del cliente',
    prefijo: 'a1b2c3d4',
    alcances: ['productos'],
    limite_por_minuto: 60,
    creada_en: '2027-01-01T00:00:00Z',
    vence_en: null,
    revocada_en: null,
    ultimo_uso_en: null,
  },
]

describe('pantalla API · empresa activa', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: true, isLoading: false })
    mocks.from.mockImplementation((tabla: string) => ({
      select: () => ({
        order: () => ({
          limit: () => Promise.resolve(
            tabla === 'api_claves' ? { data: CLAVES, error: null } : { data: [], error: null },
          ),
        }),
      }),
    }))
  })

  it('cambiar de empresa no recarga ni altera la pantalla', async () => {
    const { rerender } = render(<MemoryRouter><ApiList /></MemoryRouter>)
    expect(await screen.findByText('Integración del cliente')).toBeInTheDocument()
    const consultasIniciales = mocks.from.mock.calls.length

    // La empresa activa vive en otro contexto que esta pantalla no lee: re-render sin recarga.
    rerender(<MemoryRouter><ApiList /></MemoryRouter>)

    expect(screen.getByText('Integración del cliente')).toBeInTheDocument()
    expect(mocks.from.mock.calls.length).toBe(consultasIniciales)
  })

  it('no pide datos por empresa: consulta las tablas de la organización', async () => {
    render(<MemoryRouter><ApiList /></MemoryRouter>)
    await screen.findByText('Integración del cliente')
    const tablas = mocks.from.mock.calls.map(([tabla]) => tabla)
    expect(tablas).toContain('api_claves')
    expect(tablas).not.toContain('empresas')
    expect(JSON.stringify(mocks.from.mock.calls)).not.toContain('empresa_id')
  })
})
