import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PermisoSeccion } from '../lib/permisos'

const mocks = vi.hoisted(() => ({
  useGetIdentity: vi.fn(),
  useContextoPanel: vi.fn(),
  obtenerPermisosActuales: vi.fn(),
}))

vi.mock('@refinedev/core', () => ({ useGetIdentity: mocks.useGetIdentity }))
vi.mock('./ContextoPanel', () => ({ useContextoPanel: mocks.useContextoPanel }))
vi.mock('../lib/permisos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/permisos')>()),
  obtenerPermisosActuales: mocks.obtenerPermisosActuales,
}))

import { PermisosPanelProvider, usePermisosPanel } from './PermisosPanel'
import { useNivelSeccion } from '../hooks/useNivelSeccion'
import { usePuedeAccion } from '../hooks/usePuedeAccion'

const fila = (seccion: string, extra: Partial<PermisoSeccion> = {}): PermisoSeccion => ({
  seccion,
  nivel: 'lectura',
  eliminar: false,
  exportar: false,
  ver_costos: false,
  ...extra,
})

function Recargador() {
  const valor = usePermisosPanel()
  return <button onClick={() => valor?.recargar()}>recargar</button>
}

function Consumidor() {
  const { nivel, isLoading } = useNivelSeccion('ventas')
  const { puede } = usePuedeAccion('ventas', 'eliminar')
  return <p>{isLoading ? 'cargando' : `nivel=${nivel} eliminar=${String(puede)}`}</p>
}

describe('PermisosPanelProvider y hooks de permisos', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.useGetIdentity.mockReturnValue({ data: { id: 'u1' } })
    mocks.useContextoPanel.mockReturnValue({ contexto: { organizacion_id: 'o1' } })
  })

  it('sin provider los hooks devuelven null y no cargan', () => {
    render(<Consumidor />)
    expect(screen.getByText('nivel=null eliminar=null')).toBeInTheDocument()
  })

  it('mientras carga informa isLoading y luego expone nivel y acción', async () => {
    mocks.obtenerPermisosActuales.mockResolvedValue([fila('ventas', { nivel: 'edicion', eliminar: true })])
    render(<PermisosPanelProvider><Consumidor /></PermisosPanelProvider>)
    expect(screen.getByText('cargando')).toBeInTheDocument()
    expect(await screen.findByText('nivel=edicion eliminar=true')).toBeInTheDocument()
  })

  it('si la consulta falla deniega (ninguno) y deja traza', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.obtenerPermisosActuales.mockRejectedValue(new Error('boom'))
    render(<PermisosPanelProvider><Consumidor /></PermisosPanelProvider>)
    expect(await screen.findByText('nivel=ninguno eliminar=false')).toBeInTheDocument()
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })

  it('vuelve a pedir los permisos al cambiar de organización (clave usuario:organización)', async () => {
    mocks.obtenerPermisosActuales.mockResolvedValueOnce([fila('ventas', { nivel: 'edicion' })])
    const { rerender } = render(<PermisosPanelProvider><Consumidor /></PermisosPanelProvider>)
    await screen.findByText('nivel=edicion eliminar=false')

    mocks.obtenerPermisosActuales.mockResolvedValueOnce([fila('ventas', { nivel: 'lectura' })])
    mocks.useContextoPanel.mockReturnValue({ contexto: { organizacion_id: 'o2' } })
    rerender(<PermisosPanelProvider><Consumidor /></PermisosPanelProvider>)
    await waitFor(() => expect(screen.getByText('nivel=lectura eliminar=false')).toBeInTheDocument())
    expect(mocks.obtenerPermisosActuales).toHaveBeenCalledTimes(2)
  })

  it('recargar() vuelve a pedir los permisos y refleja el nuevo nivel (cambio de empresa activa)', async () => {
    mocks.obtenerPermisosActuales.mockResolvedValueOnce([fila('ventas', { nivel: 'edicion' })])
    render(<PermisosPanelProvider><Consumidor /><Recargador /></PermisosPanelProvider>)
    await screen.findByText('nivel=edicion eliminar=false')

    mocks.obtenerPermisosActuales.mockResolvedValueOnce([fila('ventas', { nivel: 'lectura' })])
    fireEvent.click(screen.getByRole('button', { name: 'recargar' }))
    await waitFor(() => expect(screen.getByText('nivel=lectura eliminar=false')).toBeInTheDocument())
    expect(mocks.obtenerPermisosActuales).toHaveBeenCalledTimes(2)
  })

  it('conserva los permisos si la identidad se revalida (no vacía el menú)', async () => {
    mocks.obtenerPermisosActuales.mockResolvedValue([fila('ventas', { nivel: 'edicion' })])
    const { rerender } = render(<PermisosPanelProvider><Consumidor /></PermisosPanelProvider>)
    await screen.findByText('nivel=edicion eliminar=false')

    mocks.useGetIdentity.mockReturnValue({ data: undefined, isLoading: true })
    rerender(<PermisosPanelProvider><Consumidor /></PermisosPanelProvider>)

    expect(screen.getByText('nivel=edicion eliminar=false')).toBeInTheDocument()
    expect(screen.queryByText('cargando')).not.toBeInTheDocument()
    expect(mocks.obtenerPermisosActuales).toHaveBeenCalledTimes(1)
  })

  it('mientras la identidad carga cuenta como cargando (el menú no se abre completo)', () => {
    mocks.useGetIdentity.mockReturnValue({ data: undefined, isLoading: true })
    render(<PermisosPanelProvider><Consumidor /></PermisosPanelProvider>)
    expect(screen.getByText('cargando')).toBeInTheDocument()
    expect(mocks.obtenerPermisosActuales).not.toHaveBeenCalled()
  })

  it('sin identidad no consulta', () => {
    mocks.useGetIdentity.mockReturnValue({ data: undefined })
    render(<PermisosPanelProvider><Consumidor /></PermisosPanelProvider>)
    expect(mocks.obtenerPermisosActuales).not.toHaveBeenCalled()
  })
})
