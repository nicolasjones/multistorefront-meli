import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../../test/axe'
import { HOST, destacados, mocks, responder, tienda } from './apoyo'

vi.mock('../../../../lib/supabase', async () => {
  const { mocks: m } = await import('./apoyo')
  return { supabaseClient: { schema: () => ({ rpc: m.rpc }) } }
})
vi.mock('../../../../lib/imagenProducto', () => ({ urlsImagenesProducto: async () => ({}) }))

import EstadoPreparacion from '../../secciones/EstadoPreparacion'

// F-TDA-10 (FR-006): tienda activa sin productos visibles → «Catálogo en preparación», sin error.
describe('EstadoPreparacion', () => {
  beforeEach(() => vi.clearAllMocks())

  it('muestra «Catálogo en preparación» cuando no hay productos visibles', async () => {
    responder({ destacados_por_dominio: { data: { hay_productos: false, productos: [] } } })
    const { container } = render(<EstadoPreparacion tienda={tienda} host={HOST} />)
    expect(await screen.findByRole('heading', { level: 2, name: 'Catálogo en preparación' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(await violacionesAxe(container)).toEqual([])
  })

  it('host desconocido (null) se trata como tienda sin productos', async () => {
    responder({ destacados_por_dominio: { data: null } })
    render(<EstadoPreparacion tienda={tienda} host={HOST} />)
    expect(await screen.findByText('Catálogo en preparación')).toBeInTheDocument()
  })

  it('con productos visibles (aunque no haya destacados) no aparece', async () => {
    responder({ destacados_por_dominio: { data: { ...destacados, productos: [] } } })
    const { container } = render(<EstadoPreparacion tienda={tienda} host={HOST} />)
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalled())
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('si el dato falla no inventa «en preparación»', async () => {
    responder({ destacados_por_dominio: { error: { message: 'caído' } } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container } = render(<EstadoPreparacion tienda={tienda} host={HOST} />)
    await vi.waitFor(() => expect(console.error).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
