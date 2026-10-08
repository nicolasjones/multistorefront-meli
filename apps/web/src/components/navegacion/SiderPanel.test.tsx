import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { panelFixtures } from '../../test/fixtures/panel'

const mocks = vi.hoisted(() => ({
  useContextoPanel: vi.fn(),
}))

vi.mock('../../hooks/useContextoPanel', () => ({ useContextoPanel: mocks.useContextoPanel }))
// ThemedSider depende de useMenu/useActiveAuthProvider/etc, que exigen un
// <Refine> completo — se reemplaza por un stub que solo invoca `render`,
// igual que se mockea supabaseClient en ContextoPanel.test.tsx. MenuCuenta
// vive en EncabezadoPanel, así que este archivo no necesita mockear
// useGetIdentity/useLogout.
type RenderProp = (props: { collapsed: boolean; items: never[]; logout: null }) => ReactNode
vi.mock('@refinedev/mui', () => ({ ThemedSider: ({ render }: { render: RenderProp }) => render({ collapsed: false, items: [], logout: null }) }))

import { SiderPanel } from './SiderPanel'

function renderSider() {
  return render(
    <MemoryRouter initialEntries={['/clientes']}>
      <SiderPanel />
    </MemoryRouter>,
  )
}

describe('SiderPanel', () => {
  it('muestra solo Inicio y Operación para un miembro', () => {
    mocks.useContextoPanel.mockReturnValue({ contexto: panelFixtures.miembro, isLoading: false })

    renderSider()

    expect(screen.getByRole('link', { name: 'Inicio' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Clientes' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ejecuciones' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Analítica' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Conexiones' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Miembros' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Organizaciones' })).not.toBeInTheDocument()
  })

  it('agrega Configuración para un administrador, colapsada hasta que se abre', () => {
    mocks.useContextoPanel.mockReturnValue({ contexto: panelFixtures.administrador, isLoading: false })

    renderSider()

    // Acordeón: Configuración arranca colapsada (solo Operación abre por
    // defecto), así que sus destinos no están en el documento todavía.
    expect(screen.queryByRole('link', { name: 'Conexiones' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Configuración' }))

    expect(screen.getByRole('link', { name: 'Conexiones' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Miembros' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Organizaciones' })).not.toBeInTheDocument()
  })

  it('agrega Plataforma para un superadmin sin organización activa, sin la sección de organización', () => {
    mocks.useContextoPanel.mockReturnValue({ contexto: panelFixtures.superadmin, isLoading: false })

    renderSider()

    fireEvent.click(screen.getByRole('button', { name: 'Plataforma' }))

    expect(screen.getByRole('link', { name: 'Organizaciones' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Servidores' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Funcionalidades' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'IA gobernada' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Clientes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Conexiones' })).not.toBeInTheDocument()
  })

  it('conserva el orden Inicio, Operación, Configuración, Plataforma', () => {
    mocks.useContextoPanel.mockReturnValue({
      contexto: { ...panelFixtures.superadmin, organizacion_id: 'org-1', organizacion_nombre: 'Activa', puede_escribir: true },
      isLoading: false,
    })

    renderSider()

    // El orden de las secciones no depende de cuál esté abierta (acordeón):
    // Inicio no tiene encabezado propio, así que se compara contra el
    // primer destino que sí está visible por defecto (Clientes, de
    // Operación) junto con los encabezados de Configuración y Plataforma.
    const nombres = [
      screen.getByRole('link', { name: 'Inicio' }).textContent,
      screen.getByRole('link', { name: 'Clientes' }).textContent,
      screen.getByRole('button', { name: 'Configuración' }).textContent,
      screen.getByRole('button', { name: 'Plataforma' }).textContent,
    ]

    expect(nombres).toEqual(['Inicio', 'Clientes', 'Configuración', 'Plataforma'])
  })

  it('es un acordeón: abrir una sección cierra la que estaba abierta', () => {
    mocks.useContextoPanel.mockReturnValue({
      contexto: { ...panelFixtures.superadmin, organizacion_id: 'org-1', organizacion_nombre: 'Activa', puede_escribir: true },
      isLoading: false,
    })

    renderSider()

    // Operación abre por defecto.
    expect(screen.getByRole('link', { name: 'Clientes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Operación' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Configuración' })).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Configuración' }))

    // aria-expanded es la señal síncrona y autoritativa del estado del
    // acordeón — MuiCollapse anima el desmonte real (unmountOnExit) vía
    // `transitionend`, que jsdom no dispara solo, así que no se afirma acá
    // sobre la desaparición del contenido colapsado (ver ContenidoAdaptable.
    // test.tsx para el mismo tipo de límite de jsdom con matchMedia).
    expect(screen.getByRole('button', { name: 'Operación' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Configuración' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: 'Conexiones' })).toBeInTheDocument()

    // Clickear la sección ya abierta la cierra sin abrir otra.
    fireEvent.click(screen.getByRole('button', { name: 'Configuración' }))

    expect(screen.getByRole('button', { name: 'Configuración' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('no renderiza destinos mientras el contexto está cargando', () => {
    mocks.useContextoPanel.mockReturnValue({ contexto: null, isLoading: true })

    renderSider()

    expect(screen.queryByRole('link', { name: 'Inicio' })).not.toBeInTheDocument()
  })

  it('cada ícono de destino es decorativo para el lector de pantalla', () => {
    mocks.useContextoPanel.mockReturnValue({ contexto: panelFixtures.miembro, isLoading: false })

    renderSider()

    const enlaceClientes = screen.getByRole('link', { name: 'Clientes' })
    const icono = enlaceClientes.querySelector('svg')
    expect(icono).toHaveAttribute('aria-hidden', 'true')
  })
})
