import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const createSignedUrl = vi.hoisted(() => vi.fn())
const storageFrom = vi.hoisted(() => vi.fn(() => ({ createSignedUrl })))
const rpc = vi.hoisted(() => vi.fn())
const useContextoPanel = vi.hoisted(() => vi.fn())
const puedeEscribir = vi.hoisted(() => ({ valor: false }))

vi.mock('@refinedev/mui', () => ({ CreateButton: () => <button type="button">Crear</button> }))
vi.mock('../../hooks/usePuedeGestionarMembresias', () => ({ usePuedeGestionarMembresias: () => ({ puedeEscribir: puedeEscribir.valor, isLoading: false }) }))
vi.mock('../../hooks/useContextoPanel', () => ({ useContextoPanel }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: { storage: { from: storageFrom }, rpc } }))

import { UsuarioList } from './list'

describe('UsuarioList', () => {
  beforeEach(() => { puedeEscribir.valor = false; rpc.mockReset(); createSignedUrl.mockResolvedValue({ data: null }) })

  it('obtiene la foto del integrante desde Storage y nunca consulta perfiles ajenos', async () => {
    useContextoPanel.mockReturnValue({ contexto: null })
    rpc.mockResolvedValue({ data: [{ user_id: 'member-a', rol_id: 'miembro', created_at: '2026-01-01T00:00:00Z', estado: 'activo', ultimo_acceso: null, nombre: 'Mia', apellido: 'Miembro' }], error: null })
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://storage.test/member-a' } })
    render(<UsuarioList />)

    await waitFor(() => expect(createSignedUrl).toHaveBeenCalledWith('member-a/avatar', 60))
    expect(rpc).toHaveBeenCalledWith('listar_usuarios_organizacion')
    expect(storageFrom).toHaveBeenCalledWith('fotos-perfil')
    expect(screen.getByAltText('Foto de Mia Miembro')).toHaveAttribute('src', 'https://storage.test/member-a')
  })

  it('muestra la inicial del nombre visible cuando Storage no autoriza o no encuentra foto', async () => {
    useContextoPanel.mockReturnValue({ contexto: null })
    rpc.mockResolvedValue({ data: [{ user_id: 'member-a', rol_id: 'miembro', created_at: '2026-01-01T00:00:00Z', estado: 'activo', ultimo_acceso: null, nombre: 'Mia', apellido: 'Miembro' }], error: null })
    createSignedUrl.mockResolvedValue({ data: null })
    render(<UsuarioList />)

    await waitFor(() => expect(createSignedUrl).toHaveBeenCalled())
    // Nunca un "?" fijo -- la inicial del nombre visible.
    expect(screen.getByText('M')).toBeInTheDocument()
  })

  it('muestra nombre y apellido en una única identidad visible, nunca el user_id crudo', async () => {
    useContextoPanel.mockReturnValue({ contexto: null })
    rpc.mockResolvedValue({ data: [{ user_id: 'member-a', rol_id: 'miembro', created_at: '2026-01-01T00:00:00Z', estado: 'activo', ultimo_acceso: null, nombre: 'Mia', apellido: 'Miembro' }], error: null })
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://storage.test/member-a' } })
    render(<UsuarioList />)

    await waitFor(() => expect(screen.getByText('Mia Miembro')).toBeInTheDocument())
    expect(screen.queryByText('member-a')).not.toBeInTheDocument()
  })

  it('cae en "Perfil sin completar" cuando la persona no cargó su perfil', async () => {
    useContextoPanel.mockReturnValue({ contexto: null })
    rpc.mockResolvedValue({ data: [{ user_id: 'member-b', rol_id: 'miembro', created_at: '2026-01-01T00:00:00Z', estado: 'activo', ultimo_acceso: null, nombre: null, apellido: null }], error: null })
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://storage.test/member-b' } })
    render(<UsuarioList />)

    await waitFor(() => expect(screen.getByText('Perfil sin completar')).toBeInTheDocument())
    expect(screen.queryByText('member-b')).not.toBeInTheDocument()
  })

  it('no ofrece copiar el identificador técnico fuera de superadmin', async () => {
    useContextoPanel.mockReturnValue({ contexto: { puede_copiar_identificador_tecnico: false } })
    rpc.mockResolvedValue({ data: [{ user_id: 'member-a', rol_id: 'miembro', created_at: '2026-01-01T00:00:00Z', estado: 'activo', ultimo_acceso: null, nombre: 'Mia', apellido: 'Miembro' }], error: null })
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://storage.test/member-a' } })
    render(<UsuarioList />)

    await waitFor(() => expect(screen.getByText('Mia Miembro')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /copiar identificador técnico/i })).not.toBeInTheDocument()
  })

  it('ofrece copiar el identificador técnico cuando el contexto es de superadmin', async () => {
    useContextoPanel.mockReturnValue({ contexto: { puede_copiar_identificador_tecnico: true } })
    rpc.mockResolvedValue({ data: [{ user_id: 'member-a', rol_id: 'miembro', created_at: '2026-01-01T00:00:00Z', estado: 'activo', ultimo_acceso: null, nombre: 'Mia', apellido: 'Miembro' }], error: null })
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://storage.test/member-a' } })
    render(<UsuarioList />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Copiar identificador técnico de Mia Miembro' })).toBeInTheDocument())
  })

  const fila = (extra = {}) => ({ user_id: 'u-1', rol_id: 'operador', created_at: '2026-01-01T00:00:00Z', estado: 'activo', ultimo_acceso: null, nombre: 'Ana', apellido: 'Pérez', ...extra })
  const responderListado = (filas: unknown[]) => rpc.mockImplementation(async (nombre: string) => (nombre === 'listar_usuarios_organizacion' ? { data: filas, error: null } : { data: null, error: null }))

  it('muestra rol, estado y último acceso, y no ofrece acciones a quien no gestiona usuarios (escenario 8)', async () => {
    useContextoPanel.mockReturnValue({ contexto: null })
    responderListado([fila({ estado: 'suspendido', ultimo_acceso: null })])
    render(<UsuarioList />)

    await waitFor(() => expect(screen.getByText('Ana Pérez')).toBeInTheDocument())
    expect(screen.getByText('Operador')).toBeInTheDocument()
    expect(screen.getByText('Suspendido')).toBeInTheDocument()
    expect(screen.getByText('Nunca')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Suspender' })).not.toBeInTheDocument()
  })

  it('edita el rol con la RPC y confirma «Cambios guardados»', async () => {
    puedeEscribir.valor = true
    useContextoPanel.mockReturnValue({ contexto: null })
    responderListado([fila()])
    render(<UsuarioList />)

    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    const dialogo = await screen.findByRole('dialog')
    expect(within(dialogo).getByText('Editar usuario')).toBeInTheDocument()
    expect(within(dialogo).getByRole('button', { name: 'Guardar' })).toBeDisabled()
    fireEvent.mouseDown(within(dialogo).getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: 'Depósito' }))
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('cambiar_rol_miembro', { p_target_user_id: 'u-1', p_nuevo_rol: 'deposito' }))
    expect(await screen.findByText('Cambios guardados')).toBeInTheDocument()
  })

  it('suspende tras confirmar el diálogo con el mensaje del prototipo', async () => {
    puedeEscribir.valor = true
    useContextoPanel.mockReturnValue({ contexto: null })
    responderListado([fila()])
    render(<UsuarioList />)

    fireEvent.click(await screen.findByRole('button', { name: 'Suspender' }))
    const dialogo = await screen.findByRole('dialog')
    expect(within(dialogo).getByText('Ana Pérez no va a poder entrar al panel hasta que lo reactives. Sus cambios anteriores se conservan en Actividad.')).toBeInTheDocument()
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Suspender' }))

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('suspender_miembro', { p_target_user_id: 'u-1' }))
    expect(await screen.findByText('Usuario suspendido')).toBeInTheDocument()
  })

  it('reactiva a un usuario suspendido y confirma «Usuario reactivado»', async () => {
    puedeEscribir.valor = true
    useContextoPanel.mockReturnValue({ contexto: null })
    responderListado([fila({ estado: 'suspendido' })])
    render(<UsuarioList />)

    fireEvent.click(await screen.findByRole('button', { name: 'Reactivar' }))

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('reactivar_miembro', { p_target_user_id: 'u-1' }))
    expect(await screen.findByText('Usuario reactivado')).toBeInTheDocument()
  })

  it('muestra el error de la base cuando se intenta suspender al último Administrador', async () => {
    puedeEscribir.valor = true
    useContextoPanel.mockReturnValue({ contexto: null })
    rpc.mockImplementation(async (nombre: string) => (nombre === 'listar_usuarios_organizacion'
      ? { data: [fila({ rol_id: 'administrador' })], error: null }
      : { data: null, error: { message: 'La organización debe conservar al menos un administrador' } }))
    render(<UsuarioList />)

    fireEvent.click(await screen.findByRole('button', { name: 'Suspender' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Suspender' }))

    expect(await screen.findByText('La organización debe conservar al menos un administrador')).toBeInTheDocument()
  })
})
