import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const single = vi.fn()
  // contexto_panel_actual() es `returns table(...)`: supabase-js expone
  // .rpc(...).single() para pedir la fila única en vez del array de una fila
  // que devuelve PostgREST por defecto — el mock sigue esa misma forma.
  const rpc = vi.fn(() => ({ single }))
  return { useGetIdentity: vi.fn(), single, rpc }
})

vi.mock('@refinedev/core', () => ({ useGetIdentity: mocks.useGetIdentity }))
vi.mock('../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { ContextoPanelProvider, useContextoPanel } from './ContextoPanel'

function EstadoContexto() {
  const { contexto, error, isLoading } = useContextoPanel()
  if (isLoading) return <p>Cargando contexto</p>
  if (error) return <p>Error de contexto</p>
  return <p>{contexto?.puede_escribir ? 'Puede escribir' : 'Sin permisos de escritura'}</p>
}

describe('ContextoPanelProvider', () => {
  it('mantiene el estado de carga mientras Refine resuelve la identidad', () => {
    mocks.useGetIdentity.mockReturnValue({ data: undefined, isLoading: true })

    render(<ContextoPanelProvider><EstadoContexto /></ContextoPanelProvider>)

    expect(screen.getByText('Cargando contexto')).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('expone un único contexto efectivo para la identidad autenticada', async () => {
    mocks.useGetIdentity.mockReturnValue({ data: { id: 'persona-1' }, isLoading: false })
    mocks.single.mockResolvedValue({
      data: { es_superadmin: false, organizacion_id: 'organizacion-1', organizacion_nombre: 'Acme', rol_efectivo: 'administrador', puede_escribir: true, puede_copiar_identificador_tecnico: false },
      error: null,
    })

    render(<ContextoPanelProvider><EstadoContexto /></ContextoPanelProvider>)

    expect(await screen.findByText('Puede escribir')).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledWith('contexto_panel_actual')
  })

  it('falla cerrado ante un error del RPC', async () => {
    mocks.useGetIdentity.mockReturnValue({ data: { id: 'persona-1' }, isLoading: false })
    mocks.single.mockResolvedValue({ data: null, error: { message: 'sin contexto' } })

    render(<ContextoPanelProvider><EstadoContexto /></ContextoPanelProvider>)

    expect(await screen.findByText('Error de contexto')).toBeInTheDocument()
  })
})
