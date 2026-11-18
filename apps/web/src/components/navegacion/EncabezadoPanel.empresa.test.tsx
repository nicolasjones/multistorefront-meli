import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@refinedev/mui', () => ({ HamburgerMenu: () => null }))
vi.mock('./BusquedaGlobal', () => ({ BusquedaGlobal: () => null }))
vi.mock('./CampanitaNotificaciones', () => ({ CampanitaNotificaciones: () => null }))
vi.mock('./MenuCuenta', () => ({ MenuCuenta: () => null }))
vi.mock('./PanelAyuda', () => ({ PanelAyuda: () => null }))
vi.mock('./SelectorEmpresa', () => ({ SelectorEmpresa: () => <div>selector de la ficha</div> }))
vi.mock('./SelectorEmpresaActiva', () => ({ SelectorEmpresaActiva: () => <div>selector de empresa activa</div> }))

import { EncabezadoPanel } from './EncabezadoPanel'

describe('EncabezadoPanel · selectores de empresa', () => {
  it('en la ficha de una empresa muestra un solo selector de empresa', () => {
    render(<MemoryRouter initialEntries={['/empresas/edit/e-1']}><EncabezadoPanel /></MemoryRouter>)
    expect(screen.getByText('selector de la ficha')).toBeInTheDocument()
    expect(screen.queryByText('selector de empresa activa')).not.toBeInTheDocument()
  })

  it('en las demás pantallas sigue el selector de la empresa activa', () => {
    render(<MemoryRouter initialEntries={['/productos']}><EncabezadoPanel /></MemoryRouter>)
    expect(screen.getByText('selector de empresa activa')).toBeInTheDocument()
  })
})
