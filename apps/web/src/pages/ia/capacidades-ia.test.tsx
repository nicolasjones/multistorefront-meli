import { render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// F-IA-01 · FR-025: las cuatro fuentes de consulta del asistente (catálogo, stock, precios y ventas) aparecen en las
// pantallas EXISTENTES de capacidades del chat y de MCP, con Lectura activa y Ejecución apagada, sin pantalla nueva.

const FUNCIONALIDADES = [
  { id: 'catalogo', nombre: 'Consulta de catálogo (asistente IA)' },
  { id: 'precios', nombre: 'Consulta de precios (asistente IA)' },
  { id: 'stock', nombre: 'Consulta de stock (asistente IA)' },
  { id: 'ventas', nombre: 'Consulta de ventas (asistente IA)' },
]
const CAPACIDADES = FUNCIONALIDADES.map((f) => ({ feature_id: f.id, lectura: true, ejecucion: false }))

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), useIsSuperadmin: vi.fn() }))

vi.mock('@refinedev/mui', () => ({ List: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('../../hooks/useIsSuperadmin', () => ({ useIsSuperadmin: mocks.useIsSuperadmin }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: { from: mocks.from, rpc: mocks.rpc } }))

import { IaCapacidadesChat } from './capacidades-chat'
import { IaCapacidadesMcp } from './capacidades-mcp'

/** Cadena de PostgREST mínima: cualquier `select`/`order` devuelve la misma cadena, que se resuelve con los datos de la tabla. */
function cadena(datos: unknown[]) {
  const c: Record<string, unknown> = {}
  c.select = () => c
  c.order = () => c
  c.then = (alResolver: (r: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data: datos, error: null }).then(alResolver)
  return c
}

beforeEach(() => {
  mocks.useIsSuperadmin.mockReturnValue({ isSuperadmin: true, isLoading: false })
  mocks.rpc.mockResolvedValue({ data: [], error: null })
  mocks.from.mockImplementation((tabla: string) => {
    if (tabla === 'features') return cadena(FUNCIONALIDADES)
    if (tabla === 'capacidades_chat_ia' || tabla === 'capacidades_mcp') return cadena(CAPACIDADES)
    return cadena([])
  })
})

function verificarFilas() {
  for (const f of FUNCIONALIDADES) {
    const fila = screen.getByText(f.nombre).closest('tr') as HTMLElement
    const [lectura, ejecucion] = within(fila).getAllByRole('checkbox') as HTMLInputElement[]
    expect(lectura.checked, `${f.id}: lectura activa`).toBe(true)
    expect(ejecucion.checked, `${f.id}: ejecución apagada`).toBe(false)
  }
}

describe('capacidades del asistente IA (FR-025)', () => {
  it('el chat lista las cuatro fuentes con lectura y sin ejecución', async () => {
    render(<IaCapacidadesChat />)
    await waitFor(() => expect(screen.getByText(FUNCIONALIDADES[0].nombre)).toBeInTheDocument())
    verificarFilas()
  })

  it('MCP lista las cuatro fuentes con lectura y sin ejecución', async () => {
    render(<IaCapacidadesMcp />)
    await waitFor(() => expect(screen.getByText(FUNCIONALIDADES[0].nombre)).toBeInTheDocument())
    verificarFilas()
  })

  it('no hay pantalla nueva: el asistente no agrega rutas de IA propias', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
    expect(app).not.toMatch(/path="\/ia\/(asistente|consulta)/)
  })
})
