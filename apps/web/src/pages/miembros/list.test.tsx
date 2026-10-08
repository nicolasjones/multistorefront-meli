import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const createSignedUrl = vi.hoisted(() => vi.fn())
const storageFrom = vi.hoisted(() => vi.fn(() => ({ createSignedUrl })))
const rpc = vi.hoisted(() => vi.fn())
const useContextoPanel = vi.hoisted(() => vi.fn())

vi.mock('@refinedev/mui', () => ({ CreateButton: () => <button type="button">Crear</button> }))
vi.mock('../../hooks/usePuedeGestionarMembresias', () => ({ usePuedeGestionarMembresias: () => ({ puedeEscribir: false, isLoading: false }) }))
vi.mock('../../hooks/useContextoPanel', () => ({ useContextoPanel }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: { storage: { from: storageFrom }, rpc } }))

import { MiembroList } from './list'

describe('MiembroList', () => {
  it('obtiene la foto del integrante desde Storage y nunca consulta perfiles ajenos', async () => {
    useContextoPanel.mockReturnValue({ contexto: null })
    rpc.mockResolvedValue({ data: [{ user_id: 'member-a', rol_id: 'miembro', created_at: '2026-01-01T00:00:00Z', nombre: 'Mia', apellido: 'Miembro' }], error: null })
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://storage.test/member-a' } })
    render(<MiembroList />)

    await waitFor(() => expect(createSignedUrl).toHaveBeenCalledWith('member-a/avatar', 60))
    expect(rpc).toHaveBeenCalledWith('listar_miembros_organizacion')
    expect(storageFrom).toHaveBeenCalledWith('fotos-perfil')
    expect(screen.getByAltText('Foto de Mia Miembro')).toHaveAttribute('src', 'https://storage.test/member-a')
  })

  it('muestra la inicial del nombre visible cuando Storage no autoriza o no encuentra foto', async () => {
    useContextoPanel.mockReturnValue({ contexto: null })
    rpc.mockResolvedValue({ data: [{ user_id: 'member-a', rol_id: 'miembro', created_at: '2026-01-01T00:00:00Z', nombre: 'Mia', apellido: 'Miembro' }], error: null })
    createSignedUrl.mockResolvedValue({ data: null })
    render(<MiembroList />)

    await waitFor(() => expect(createSignedUrl).toHaveBeenCalled())
    // Nunca un "?" fijo -- la inicial del nombre visible.
    expect(screen.getByText('M')).toBeInTheDocument()
  })

  it('muestra nombre y apellido en una única identidad visible, nunca el user_id crudo', async () => {
    useContextoPanel.mockReturnValue({ contexto: null })
    rpc.mockResolvedValue({ data: [{ user_id: 'member-a', rol_id: 'miembro', created_at: '2026-01-01T00:00:00Z', nombre: 'Mia', apellido: 'Miembro' }], error: null })
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://storage.test/member-a' } })
    render(<MiembroList />)

    await waitFor(() => expect(screen.getByText('Mia Miembro')).toBeInTheDocument())
    expect(screen.queryByText('member-a')).not.toBeInTheDocument()
  })

  it('cae en "Perfil sin completar" cuando la persona no cargó su perfil', async () => {
    useContextoPanel.mockReturnValue({ contexto: null })
    rpc.mockResolvedValue({ data: [{ user_id: 'member-b', rol_id: 'miembro', created_at: '2026-01-01T00:00:00Z', nombre: null, apellido: null }], error: null })
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://storage.test/member-b' } })
    render(<MiembroList />)

    await waitFor(() => expect(screen.getByText('Perfil sin completar')).toBeInTheDocument())
    expect(screen.queryByText('member-b')).not.toBeInTheDocument()
  })

  it('no ofrece copiar el identificador técnico fuera de superadmin', async () => {
    useContextoPanel.mockReturnValue({ contexto: { puede_copiar_identificador_tecnico: false } })
    rpc.mockResolvedValue({ data: [{ user_id: 'member-a', rol_id: 'miembro', created_at: '2026-01-01T00:00:00Z', nombre: 'Mia', apellido: 'Miembro' }], error: null })
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://storage.test/member-a' } })
    render(<MiembroList />)

    await waitFor(() => expect(screen.getByText('Mia Miembro')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /copiar identificador técnico/i })).not.toBeInTheDocument()
  })

  it('ofrece copiar el identificador técnico cuando el contexto es de superadmin', async () => {
    useContextoPanel.mockReturnValue({ contexto: { puede_copiar_identificador_tecnico: true } })
    rpc.mockResolvedValue({ data: [{ user_id: 'member-a', rol_id: 'miembro', created_at: '2026-01-01T00:00:00Z', nombre: 'Mia', apellido: 'Miembro' }], error: null })
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://storage.test/member-a' } })
    render(<MiembroList />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Copiar identificador técnico de Mia Miembro' })).toBeInTheDocument())
  })
})
