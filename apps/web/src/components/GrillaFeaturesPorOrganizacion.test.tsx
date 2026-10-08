import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { supabaseClient } from '../lib/supabase'
import { GrillaFeaturesPorOrganizacion } from './GrillaFeaturesPorOrganizacion'

vi.mock('../lib/supabase', () => ({
  supabaseClient: {
    rpc: vi.fn(),
  },
}))

const organizaciones = [
  { id: 'org-x', nombre: 'Organización X' },
  { id: 'org-y', nombre: 'Organización Y' },
]

const features = [{ id: 'feature-de-prueba', nombre: 'Feature de prueba' }]

describe('GrillaFeaturesPorOrganizacion', () => {
  it('muestra el mensaje de catálogo vacío en vez de una tabla sin columnas (FR-013)', () => {
    render(
      <GrillaFeaturesPorOrganizacion
        organizaciones={organizaciones}
        features={[]}
        habilitaciones={[]}
        onCambio={vi.fn()}
        onError={vi.fn()}
      />,
    )

    expect(
      screen.getByText('Todavía no hay funcionalidades registradas en el catálogo.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('togglear una celda deshabilitada llama a habilitar_feature con los ids esperados', async () => {
    vi.mocked(supabaseClient.rpc).mockResolvedValue({ data: null, error: null } as never)
    const onCambio = vi.fn()

    render(
      <GrillaFeaturesPorOrganizacion
        organizaciones={organizaciones}
        features={features}
        habilitaciones={[]}
        onCambio={onCambio}
        onError={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: 'Feature de prueba — Organización X' }))

    expect(supabaseClient.rpc).toHaveBeenCalledWith('habilitar_feature', {
      p_feature_id: 'feature-de-prueba',
      p_organizacion_id: 'org-x',
    })
    await vi.waitFor(() => expect(onCambio).toHaveBeenCalled())
  })

  it('togglear una celda habilitada llama a deshabilitar_feature con los ids esperados', async () => {
    vi.mocked(supabaseClient.rpc).mockResolvedValue({ data: null, error: null } as never)
    const onCambio = vi.fn()

    render(
      <GrillaFeaturesPorOrganizacion
        organizaciones={organizaciones}
        features={features}
        habilitaciones={[{ feature_id: 'feature-de-prueba', organizacion_id: 'org-x' }]}
        onCambio={onCambio}
        onError={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: 'Feature de prueba — Organización X' }))

    expect(supabaseClient.rpc).toHaveBeenCalledWith('deshabilitar_feature', {
      p_feature_id: 'feature-de-prueba',
      p_organizacion_id: 'org-x',
    })
    await vi.waitFor(() => expect(onCambio).toHaveBeenCalled())
  })

  it('un error de la RPC se reporta con onError y no llama a onCambio', async () => {
    vi.mocked(supabaseClient.rpc).mockResolvedValue({
      data: null,
      error: { message: 'permiso denegado' },
    } as never)
    const onCambio = vi.fn()
    const onError = vi.fn()

    render(
      <GrillaFeaturesPorOrganizacion
        organizaciones={organizaciones}
        features={features}
        habilitaciones={[]}
        onCambio={onCambio}
        onError={onError}
      />,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: 'Feature de prueba — Organización X' }))

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('permiso denegado'))
    expect(onCambio).not.toHaveBeenCalled()
  })
})
