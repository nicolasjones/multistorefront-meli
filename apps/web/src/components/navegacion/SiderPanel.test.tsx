import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { panelFixtures } from '../../test/fixtures/panel'

const mocks = vi.hoisted(() => ({
  useContextoPanel: vi.fn(),
  usePermisosPanel: vi.fn(),
  useFeatureHabilitada: vi.fn(),
}))

vi.mock('../../hooks/useFeatureHabilitada', () => ({ useFeatureHabilitada: mocks.useFeatureHabilitada }))

vi.mock('../../hooks/useContextoPanel', () => ({ useContextoPanel: mocks.useContextoPanel }))
vi.mock('../../context/PermisosPanel', () => ({ usePermisosPanel: mocks.usePermisosPanel }))
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
  beforeEach(() => {
    // Sin permisos de sección (`null`): el menú se filtra solo por audiencia,
    // como antes de tener el proveedor. Los tests que necesitan la matriz lo
    // sobreescriben.
    mocks.usePermisosPanel.mockReturnValue({ permisos: null, isLoading: false, recargar: vi.fn() })
    mocks.useFeatureHabilitada.mockReturnValue({ habilitada: false, isLoading: false })
  })

  it('ofrece Service técnico solo con la funcionalidad habilitada (FR-009)', () => {
    mocks.useContextoPanel.mockReturnValue({ contexto: panelFixtures.miembro, isLoading: false })
    const { unmount } = renderSider()
    expect(screen.queryByRole('link', { name: 'Service técnico' })).not.toBeInTheDocument()
    unmount()

    mocks.useFeatureHabilitada.mockReturnValue({ habilitada: true, isLoading: false })
    renderSider()
    fireEvent.click(screen.getByRole('button', { name: /Service/ }))
    expect(screen.getByRole('link', { name: 'Service técnico' })).toHaveAttribute('href', '/service-tecnico/reparaciones')
  })
  it('muestra Inicio y Contactos para un miembro', () => {
    mocks.useContextoPanel.mockReturnValue({ contexto: panelFixtures.miembro, isLoading: false })

    renderSider()

    expect(screen.getByRole('link', { name: 'Inicio' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Contactos' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: 'Clientes' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Proveedores' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Ejecuciones' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Analítica' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Conexiones' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Usuarios' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Organizaciones' })).not.toBeInTheDocument()
  })

  it('muestra Empresas al administrador dentro de Canales y se la oculta al miembro (F-EMP-01, FR-004)', () => {
    mocks.useContextoPanel.mockReturnValue({ contexto: panelFixtures.miembro, isLoading: false })
    const { unmount } = renderSider()
    expect(screen.queryByRole('button', { name: 'Canales' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Empresas' })).not.toBeInTheDocument()
    unmount()

    mocks.useContextoPanel.mockReturnValue({ contexto: panelFixtures.administrador, isLoading: false })
    renderSider()
    fireEvent.click(screen.getByRole('button', { name: 'Canales' }))
    expect(screen.getByRole('link', { name: 'Empresas' })).toHaveAttribute('href', '/empresas')
  })

  it('agrega Administración para un administrador, colapsada hasta que se abre', () => {
    mocks.useContextoPanel.mockReturnValue({ contexto: panelFixtures.administrador, isLoading: false })

    renderSider()

    // Acordeón: Administración arranca colapsada (solo Contactos abre por
    // defecto), así que sus destinos no están en el documento todavía.
    expect(screen.queryByRole('link', { name: 'Usuarios' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Administración' }))

    expect(screen.getByRole('link', { name: 'Usuarios' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Roles y permisos' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Actividad' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Conexiones' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Conexiones OAuth' })).not.toBeInTheDocument()
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
    expect(screen.queryByRole('link', { name: 'Analítica (administrar)' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Clientes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Conexiones' })).not.toBeInTheDocument()
  })

  it('conserva el orden Inicio, Contactos, Canales, Administración, Plataforma', () => {
    mocks.useContextoPanel.mockReturnValue({
      contexto: { ...panelFixtures.superadmin, organizacion_id: 'org-1', organizacion_nombre: 'Activa', puede_escribir: true },
      isLoading: false,
    })

    renderSider()

    const esperadas = ['Contactos', 'Canales', 'Administración', 'Plataforma']
    const nombres = screen.getAllByRole('button')
      .map((boton) => boton.textContent?.trim())
      .filter((nombre): nombre is string => Boolean(nombre && esperadas.includes(nombre)))
    expect(nombres).toEqual(esperadas)
    expect(screen.getByRole('link', { name: 'Inicio' })).toBeInTheDocument()
  })

  it('es un acordeón: abrir una sección cierra la que estaba abierta', () => {
    mocks.useContextoPanel.mockReturnValue({
      contexto: { ...panelFixtures.superadmin, organizacion_id: 'org-1', organizacion_nombre: 'Activa', puede_escribir: true },
      isLoading: false,
    })

    renderSider()

    // Contactos abre por defecto.
    expect(screen.getByRole('link', { name: 'Clientes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Contactos' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Administración' })).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Administración' }))

    // aria-expanded es la señal síncrona y autoritativa del estado del
    // acordeón — MuiCollapse anima el desmonte real (unmountOnExit) vía
    // `transitionend`, que jsdom no dispara solo, así que no se afirma acá
    // sobre la desaparición del contenido colapsado (ver ContenidoAdaptable.
    // test.tsx para el mismo tipo de límite de jsdom con matchMedia).
    expect(screen.getByRole('button', { name: 'Contactos' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Administración' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: 'Usuarios' })).toBeInTheDocument()

    // Clickear la sección ya abierta la cierra sin abrir otra.
    fireEvent.click(screen.getByRole('button', { name: 'Administración' }))

    expect(screen.getByRole('button', { name: 'Administración' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('no renderiza destinos mientras el contexto está cargando', () => {
    mocks.useContextoPanel.mockReturnValue({ contexto: null, isLoading: true })

    renderSider()

    expect(screen.queryByRole('link', { name: 'Inicio' })).not.toBeInTheDocument()
  })

  it('dentro de Stock ofrece Stock y Movimientos', () => {
    mocks.useContextoPanel.mockReturnValue({ contexto: panelFixtures.miembro, isLoading: false })

    renderSider()

    fireEvent.click(screen.getByRole('button', { name: 'Stock' }))

    expect(screen.getByRole('link', { name: 'Stock' })).toHaveAttribute('href', '/stock')
    expect(screen.getByRole('link', { name: 'Movimientos' })).toHaveAttribute('href', '/stock/movimientos')
  })

  it('cada ícono de destino es decorativo para el lector de pantalla', () => {
    mocks.useContextoPanel.mockReturnValue({ contexto: panelFixtures.miembro, isLoading: false })

    renderSider()

    const enlaceClientes = screen.getByRole('link', { name: 'Clientes' })
    const icono = enlaceClientes.querySelector('svg')
    expect(icono).toHaveAttribute('aria-hidden', 'true')
  })

  it('no vacía el menú mientras se recargan los permisos (cambio de empresa activa)', () => {
    // Al cambiar la empresa activa (F-ROL-06) se recargan los permisos: el
    // menú debe seguir visible con lo último cargado, sin parpadear.
    mocks.useContextoPanel.mockReturnValue({ contexto: panelFixtures.miembro, isLoading: false })
    mocks.usePermisosPanel.mockReturnValue({
      permisos: [{ seccion: 'clientes', nivel: 'lectura', acciones: [] }],
      isLoading: true,
      recargar: vi.fn(),
    })

    renderSider()

    expect(screen.getByRole('link', { name: 'Clientes' })).toBeInTheDocument()
  })

  it('no renderiza destinos mientras los permisos cargan por primera vez', () => {
    mocks.useContextoPanel.mockReturnValue({ contexto: panelFixtures.miembro, isLoading: false })
    mocks.usePermisosPanel.mockReturnValue({ permisos: null, isLoading: true, recargar: vi.fn() })

    renderSider()

    expect(screen.queryByRole('link', { name: 'Clientes' })).not.toBeInTheDocument()
  })
})
