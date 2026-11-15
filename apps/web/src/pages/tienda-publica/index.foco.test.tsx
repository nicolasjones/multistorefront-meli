import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ resolver: vi.fn() }))
vi.mock('../../lib/tienda', () => ({ resolverTienda: mocks.resolver, resolverRedireccion: vi.fn(), urlDeRedireccion: (p: string) => p }))
vi.mock('../../lib/tiendaEstado', () => ({ useEstadoTienda: () => ({ estado: { fase: 'cargando' }, reintentar: vi.fn() }) }))

import { TiendaPublicaApp } from './index'

// MSF-849 (revisión): el foco unificado también llega a los estados fuera del layout (carga, error, «Volvemos pronto»).
describe('TiendaPublicaApp · foco de teclado', () => {
  it('monta el contorno de foco desde la raíz, incluso mientras resuelve la tienda (estado de carga)', () => {
    mocks.resolver.mockReturnValue(new Promise(() => undefined))
    render(<TiendaPublicaApp host="mundojc.localhost" />)
    const css = Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('')
    expect(css).toContain('html a:focus-visible')
    expect(css).toContain('--tienda-color-foco')
  })
})
