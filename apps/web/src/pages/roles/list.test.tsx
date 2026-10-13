import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  usePuedeEscribir: vi.fn(),
  useContextoPanel: vi.fn(),
  invalidar: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabaseClient: { from: mocks.from, rpc: mocks.rpc } }))
vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: mocks.usePuedeEscribir }))
vi.mock('../../hooks/useContextoPanel', () => ({ useContextoPanel: mocks.useContextoPanel }))

import { RolesPermisos } from './list'
import { SECCIONES_MATRIZ, ROLES_MATRIZ } from '../../lib/permisos'

const permisos = ROLES_MATRIZ.flatMap((rol) =>
  SECCIONES_MATRIZ.map((s) => ({ rol_id: rol, seccion: s.clave, nivel: rol === 'administrador' ? 'edicion' : 'lectura' })),
)
const permisosAccion = ROLES_MATRIZ.flatMap((rol) =>
  SECCIONES_MATRIZ.flatMap((s) => ['eliminar', 'exportar', 'ver_costos'].map((accion) => ({
    rol_id: rol, seccion: s.clave, accion, permitido: rol === 'administrador',
  }))),
)

function tabla(nombre: string) {
  const datos: Record<string, unknown[]> = {
    roles_organizacion: ROLES_MATRIZ.map((id) => ({ id, descripcion: `Descripción de ${id}` })),
    permisos_rol: permisos,
    permisos_rol_accion: permisosAccion,
    usuarios_organizacion: [{ rol_id: 'operador' }, { rol_id: 'operador' }, { rol_id: 'administrador' }],
  }
  return { select: () => Promise.resolve({ data: datos[nombre], error: null }) }
}

const celda = (seccion: string, rol: string) =>
  screen.getByLabelText(new RegExp(`^${seccion}, ${rol}:`))

describe('RolesPermisos', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.from.mockImplementation(tabla)
    mocks.rpc.mockResolvedValue({ error: null })
    mocks.useContextoPanel.mockReturnValue({ contexto: { organizacion_nombre: 'Org Uno' }, isLoading: false })
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: true, isLoading: false })
  })

  it('muestra los seis roles con descripción y cantidad de usuarios, y las 16 secciones', async () => {
    render(<RolesPermisos />)
    expect(await screen.findByText('Descripción de operador')).toBeInTheDocument()
    expect(screen.getByText('2 usuarios')).toBeInTheDocument()
    expect(screen.getByText('1 usuario')).toBeInTheDocument()
    const grilla = screen.getByRole('table', { name: 'Matriz de permisos por sección' })
    expect(within(grilla).getAllByRole('row')).toHaveLength(1 + 16)
  })

  it('rota Edición → Solo lectura → Sin acceso → Edición y habilita Guardar según los cambios pendientes', async () => {
    render(<RolesPermisos />)
    await screen.findByText('Descripción de operador')
    const guardar = screen.getByRole('button', { name: 'Guardar cambios' })
    expect(guardar).toBeDisabled()
    expect(screen.getByText('Sin cambios pendientes.')).toBeInTheDocument()

    // El operador parte en «Solo lectura» en este fixture.
    fireEvent.click(celda('Stock', 'Operador'))
    expect(celda('Stock', 'Operador')).toHaveAttribute('aria-label', expect.stringContaining('Sin acceso'))
    expect(guardar).toBeEnabled()
    expect(screen.getByText('1 cambio pendiente.')).toBeInTheDocument()

    fireEvent.click(celda('Stock', 'Operador'))
    expect(celda('Stock', 'Operador')).toHaveAttribute('aria-label', expect.stringContaining('Edición'))
    fireEvent.click(celda('Stock', 'Operador'))
    expect(celda('Stock', 'Operador')).toHaveAttribute('aria-label', expect.stringContaining('Solo lectura'))
    expect(guardar).toBeDisabled()
  })

  it('la columna Administrador está bloqueada', async () => {
    render(<RolesPermisos />)
    await screen.findByText('Descripción de operador')
    expect(celda('Stock', 'Administrador')).toBeDisabled()
  })

  it('guarda solo los cambios, invalida la caché y recarga', async () => {
    render(<RolesPermisos />)
    await screen.findByText('Descripción de operador')
    fireEvent.click(celda('Ventas', 'Consulta'))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('guardar_matriz_permisos', {
      p_niveles: [{ rol_id: 'consulta', seccion: 'ventas', nivel: 'ninguno' }],
      p_acciones: [],
    }))
    expect(await screen.findByText('Cambios guardados.')).toBeInTheDocument()
  })

  it('edita acciones con el selector de acción', async () => {
    render(<RolesPermisos />)
    await screen.findByText('Descripción de operador')
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Exportar en Productos, Operador' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('guardar_matriz_permisos', {
      p_niveles: [],
      p_acciones: [{ rol_id: 'operador', seccion: 'productos', accion: 'exportar', permitido: true }],
    }))
  })

  it('muestra el error del servidor y conserva los cambios pendientes', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'Solo un Administrador de la organización puede editar la matriz de permisos' } })
    render(<RolesPermisos />)
    await screen.findByText('Descripción de operador')
    fireEvent.click(celda('Stock', 'Operador'))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText(/Solo un Administrador de la organización/)).toBeInTheDocument()
    expect(screen.getByText('1 cambio pendiente.')).toBeInTheDocument()
  })

  it('restablecer pide confirmación y llama la RPC', async () => {
    render(<RolesPermisos />)
    await screen.findByText('Descripción de operador')
    fireEvent.click(screen.getByRole('button', { name: 'Restablecer valores iniciales' }))
    expect(mocks.rpc).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restablecer' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('restablecer_matriz_permisos'))
    expect(await screen.findByText('Valores iniciales restablecidos.')).toBeInTheDocument()
  })

  it('sin permiso de escritura la matriz es de solo lectura y no ofrece guardar', async () => {
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: false, isLoading: false })
    render(<RolesPermisos />)
    await screen.findByText('Descripción de operador')
    expect(screen.getByText(/Solo un Administrador puede editar/)).toBeInTheDocument()
    expect(celda('Stock', 'Operador')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument()
  })
})
