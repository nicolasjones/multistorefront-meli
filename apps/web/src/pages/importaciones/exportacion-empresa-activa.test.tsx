import { MemoryRouter } from 'react-router'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { consultasExportacionTotal, exportacionTotal, falso, reiniciarFalso, responderExportacionTotal } from './soporteTest'

vi.mock('../../lib/supabase', async () => ({ supabaseClient: (await import('./soporteTest')).supabaseFalso }))
vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: () => ({ puedeEscribir: true, isLoading: false }) }))
vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: (...args: unknown[]) => falso.filtro(...args) }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { ImportacionesList } from './list'

function conActivaCambiante() {
  let cambiarActiva: (id: string | null) => void = () => {}
  falso.filtro.mockImplementation(() => {
    const [activa, setActiva] = useState<string | null>('e-1')
    cambiarActiva = setActiva
    return {
      empresas: [{ id: 'e-1', nombre: 'San Javucho' }, { id: 'e-2', nombre: 'Mundo JC' }],
      valor: activa,
      cambiar: setActiva,
      empresaActivaId: activa,
      cargando: false,
      hayError: false,
    }
  })
  return (id: string | null) => act(() => cambiarActiva(id))
}

// Constitución, Principio VIII: la exportación total es de TODA la organización, así que no depende de la empresa
// activa (FR-039). Este test fija esa decisión: cambiar de empresa no la oculta, no la recarga con otro filtro y no
// cierra el diálogo abierto.
describe('[MSF-396:T026] Exportar todos los datos con la empresa activa (FR-039)', () => {
  beforeEach(() => {
    reiniciarFalso()
    responderExportacionTotal(exportacionTotal())
    falso.rpc.mockResolvedValue({ data: [{ proceso_id: 'p-900', ejecucion_id: 'ej-900', estado: 'pendiente', reutilizado: false }], error: null })
  })

  it('con una empresa activa, el bloque se ve y consulta sin filtrar por empresa', async () => {
    conActivaCambiante()
    render(<MemoryRouter><ImportacionesList /></MemoryRouter>)
    const bloque = within(await screen.findByRole('region', { name: 'Exportar todos los datos' }))
    expect(await bloque.findByText('Tu exportación está lista.')).toBeInTheDocument()
    const filtros = consultasExportacionTotal().flatMap((consulta) => consulta.filtros.map(([columna]) => columna))
    expect(filtros).toEqual(['funcionalidad'])
  })

  it('al cambiar de empresa el bloque sigue ahí y el diálogo abierto no se cierra ni cambia de organización', async () => {
    const cambiarActiva = conActivaCambiante()
    render(<MemoryRouter><ImportacionesList /></MemoryRouter>)
    const bloque = within(await screen.findByRole('region', { name: 'Exportar todos los datos' }))
    fireEvent.click(await bloque.findByRole('button', { name: 'Exportar todos los datos' }))
    expect(await screen.findByRole('dialog', { name: '¿Exportar todos los datos de la organización?' })).toBeInTheDocument()

    cambiarActiva('e-2')

    await waitFor(() => expect(screen.getByRole('dialog', { name: '¿Exportar todos los datos de la organización?' })).toBeInTheDocument())
    // Con el diálogo abierto el resto de la pantalla queda aria-hidden: se busca igual (hidden).
    expect(screen.getByRole('region', { name: 'Exportar todos los datos', hidden: true })).toBeInTheDocument()
    // La pantalla no avisa «cambiaste de empresa» por el diálogo de la exportación total: no depende de ella.
    expect(screen.queryByText(/Cambiaste de empresa/)).not.toBeInTheDocument()
    const filtros = consultasExportacionTotal().flatMap((consulta) => consulta.filtros.map(([columna]) => columna))
    expect(filtros.every((columna) => columna === 'funcionalidad')).toBe(true)
  })

  it('con «Todas las tiendas» el bloque es el mismo', async () => {
    const cambiarActiva = conActivaCambiante()
    render(<MemoryRouter><ImportacionesList /></MemoryRouter>)
    await screen.findByRole('region', { name: 'Exportar todos los datos' })
    cambiarActiva(null)
    const bloque = within(await screen.findByRole('region', { name: 'Exportar todos los datos' }))
    expect(await bloque.findByText('Tu exportación está lista.')).toBeInTheDocument()
  })
})
