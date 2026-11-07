import { MemoryRouter } from 'react-router'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../test/axe'
import { configurarFiltro, exportacionTotal, falso, reiniciarFalso, responderExportacionTotal } from './soporteTest'

vi.mock('../../lib/supabase', async () => ({ supabaseClient: (await import('./soporteTest')).supabaseFalso }))
vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: () => ({ puedeEscribir: true, isLoading: false }) }))
vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: (...args: unknown[]) => falso.filtro(...args) }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { ImportacionesList } from './list'

// FR-039 (T027): accesibilidad del bloque y de su diálogo. El layout a 320/768/1440 px se verifica en el E2E
// (jsdom no calcula layout): acá, roles, nombres, foco y reglas de axe.
describe('[MSF-396:T027] Accesibilidad de «Exportar todos los datos» (FR-039)', () => {
  beforeEach(() => {
    reiniciarFalso()
    configurarFiltro(null)
    responderExportacionTotal(exportacionTotal({ estado: 'en_curso', procesados: 2, total: 8, finalizado_en: null }))
  })

  it('el bloque no tiene violaciones de axe y la región se anuncia por su título', async () => {
    const { container } = render(<MemoryRouter><ImportacionesList /></MemoryRouter>)
    const region = await screen.findByRole('region', { name: 'Exportar todos los datos' })
    expect(await within(region).findByText('Estamos preparando tu exportación.')).toBeInTheDocument()
    expect(await violacionesAxe(container)).toEqual([])
  })

  it('el avance es una barra con nombre y el estado se anuncia con aria-live', async () => {
    render(<MemoryRouter><ImportacionesList /></MemoryRouter>)
    const region = await screen.findByRole('region', { name: 'Exportar todos los datos' })
    const barra = await within(region).findByRole('progressbar', { name: 'Avance de la exportación total' })
    expect(barra).toHaveAttribute('aria-valuenow', '25')
    expect(barra.closest('[aria-live="polite"]')).not.toBeNull()
  })

  it('el diálogo tiene nombre accesible, enfoca su contenido y se opera con teclado', async () => {
    responderExportacionTotal(null)
    render(<MemoryRouter><ImportacionesList /></MemoryRouter>)
    const region = await screen.findByRole('region', { name: 'Exportar todos los datos' })
    const abrir = await within(region).findByRole('button', { name: 'Exportar todos los datos' })
    abrir.focus()
    fireEvent.click(abrir)
    const dialogo = await screen.findByRole('dialog', { name: '¿Exportar todos los datos de la organización?' })
    expect(dialogo).toHaveAttribute('aria-labelledby')
    // MUI deja el foco en el contenedor del modal (trampa de foco): dentro del diálogo, no en el botón de atrás.
    await waitFor(() => expect(dialogo.closest('.MuiModal-root')?.contains(document.activeElement)).toBe(true))
    expect(await violacionesAxe(document.body)).toEqual([])
    const confirmar = within(dialogo).getByRole('button', { name: 'Sí, exportar' })
    expect(confirmar).toBeEnabled()
    expect(within(dialogo).getByRole('button', { name: 'Cancelar' })).toBeEnabled()
  })

  it('no usa identificadores técnicos como texto visible', async () => {
    render(<MemoryRouter><ImportacionesList /></MemoryRouter>)
    const region = await screen.findByRole('region', { name: 'Exportar todos los datos' })
    await within(region).findByText('Estamos preparando tu exportación.')
    expect(region.textContent).not.toMatch(/exportacion_total|[0-9a-f]{8}-[0-9a-f]{4}|procesos_masivos/i)
  })
})
