import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const createSignedUrls = vi.hoisted(() => vi.fn())
const storageFrom = vi.hoisted(() => vi.fn(() => ({ createSignedUrls })))
const resetPasswordForEmail = vi.hoisted(() => vi.fn())
const rpc = vi.hoisted(() => vi.fn())
const useContextoPanel = vi.hoisted(() => vi.fn())
const puedeEscribir = vi.hoisted(() => ({ valor: false }))

vi.mock('../../components/usuarios/InvitacionesPendientes', () => ({ InvitacionesPendientes: () => null }))
vi.mock('../../components/usuarios/DialogoInvitarUsuario', () => ({ DialogoInvitarUsuario: () => null }))
vi.mock('../../hooks/usePuedeGestionarMembresias', () => ({ usePuedeGestionarMembresias: () => ({ puedeEscribir: puedeEscribir.valor, isLoading: false }) }))
vi.mock('../../hooks/useContextoPanel', () => ({ useContextoPanel }))
vi.mock('../../lib/supabase', () => ({
  supabaseClient: { storage: { from: storageFrom }, rpc, auth: { resetPasswordForEmail } },
  passwordDefinitionRedirectUrl: (tipo: string, origin: string) => `${origin}/definir-contrasena?tipo=${tipo}`,
}))

import { UsuarioList } from './list'

describe('UsuarioList', () => {
  beforeEach(() => { puedeEscribir.valor = false; rpc.mockReset(); createSignedUrls.mockResolvedValue({ data: null }); resetPasswordForEmail.mockReset() })

  it('obtiene la foto del integrante desde Storage y nunca consulta perfiles ajenos', async () => {
    useContextoPanel.mockReturnValue({ contexto: null })
    rpc.mockResolvedValue({ data: [{ user_id: 'member-a', rol_id: 'miembro', created_at: '2026-01-01T00:00:00Z', estado: 'activo', ultimo_acceso: null, email: null, es_propio: false, nombre: 'Mia', apellido: 'Miembro' }], error: null })
    createSignedUrls.mockResolvedValue({ data: [{ path: 'member-a/avatar', signedUrl: 'https://storage.test/member-a', error: null }] })
    render(<UsuarioList />)

    await waitFor(() => expect(createSignedUrls).toHaveBeenCalledWith(['member-a/avatar'], 60))
    expect(rpc).toHaveBeenCalledWith('listar_usuarios_organizacion')
    expect(storageFrom).toHaveBeenCalledWith('fotos-perfil')
    expect(screen.getByAltText('Foto de Mia Miembro')).toHaveAttribute('src', 'https://storage.test/member-a')
  })

  it('muestra la inicial del nombre visible cuando Storage no autoriza o no encuentra foto', async () => {
    useContextoPanel.mockReturnValue({ contexto: null })
    rpc.mockResolvedValue({ data: [{ user_id: 'member-a', rol_id: 'miembro', created_at: '2026-01-01T00:00:00Z', estado: 'activo', ultimo_acceso: null, email: null, es_propio: false, nombre: 'Mia', apellido: 'Miembro' }], error: null })
    createSignedUrls.mockResolvedValue({ data: null })
    render(<UsuarioList />)

    await waitFor(() => expect(createSignedUrls).toHaveBeenCalled())
    // Nunca un "?" fijo -- la inicial del nombre visible.
    expect(screen.getByText('M')).toBeInTheDocument()
  })

  it('muestra nombre y apellido en una única identidad visible, nunca el user_id crudo', async () => {
    useContextoPanel.mockReturnValue({ contexto: null })
    rpc.mockResolvedValue({ data: [{ user_id: 'member-a', rol_id: 'miembro', created_at: '2026-01-01T00:00:00Z', estado: 'activo', ultimo_acceso: null, email: null, es_propio: false, nombre: 'Mia', apellido: 'Miembro' }], error: null })
    createSignedUrls.mockResolvedValue({ data: [{ path: 'member-a/avatar', signedUrl: 'https://storage.test/member-a', error: null }] })
    render(<UsuarioList />)

    await waitFor(() => expect(screen.getByText('Mia Miembro')).toBeInTheDocument())
    expect(screen.queryByText('member-a')).not.toBeInTheDocument()
  })

  it('cae en "Perfil sin completar" cuando la persona no cargó su perfil', async () => {
    useContextoPanel.mockReturnValue({ contexto: null })
    rpc.mockResolvedValue({ data: [{ user_id: 'member-b', rol_id: 'miembro', created_at: '2026-01-01T00:00:00Z', estado: 'activo', ultimo_acceso: null, email: null, es_propio: false, nombre: null, apellido: null }], error: null })
    createSignedUrls.mockResolvedValue({ data: [{ path: 'member-b/avatar', signedUrl: 'https://storage.test/member-b', error: null }] })
    render(<UsuarioList />)

    await waitFor(() => expect(screen.getByText('Perfil sin completar')).toBeInTheDocument())
    expect(screen.queryByText('member-b')).not.toBeInTheDocument()
  })

  it('no ofrece copiar el identificador técnico fuera de superadmin', async () => {
    useContextoPanel.mockReturnValue({ contexto: { puede_copiar_identificador_tecnico: false } })
    rpc.mockResolvedValue({ data: [{ user_id: 'member-a', rol_id: 'miembro', created_at: '2026-01-01T00:00:00Z', estado: 'activo', ultimo_acceso: null, email: null, es_propio: false, nombre: 'Mia', apellido: 'Miembro' }], error: null })
    createSignedUrls.mockResolvedValue({ data: [{ path: 'member-a/avatar', signedUrl: 'https://storage.test/member-a', error: null }] })
    render(<UsuarioList />)

    await waitFor(() => expect(screen.getByText('Mia Miembro')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /copiar identificador técnico/i })).not.toBeInTheDocument()
  })

  it('ofrece copiar el identificador técnico cuando el contexto es de superadmin', async () => {
    useContextoPanel.mockReturnValue({ contexto: { puede_copiar_identificador_tecnico: true } })
    rpc.mockResolvedValue({ data: [{ user_id: 'member-a', rol_id: 'miembro', created_at: '2026-01-01T00:00:00Z', estado: 'activo', ultimo_acceso: null, email: null, es_propio: false, nombre: 'Mia', apellido: 'Miembro' }], error: null })
    createSignedUrls.mockResolvedValue({ data: [{ path: 'member-a/avatar', signedUrl: 'https://storage.test/member-a', error: null }] })
    render(<UsuarioList />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Copiar identificador técnico de Mia Miembro' })).toBeInTheDocument())
  })

  const fila = (extra = {}) => ({ user_id: 'u-1', rol_id: 'operador', created_at: '2026-01-01T00:00:00Z', estado: 'activo', ultimo_acceso: null, email: 'ana@example.com', es_propio: false, nombre: 'Ana', apellido: 'Pérez', ...extra })
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

  it('edita el rol con la RPC y confirma «Usuario guardado»', async () => {
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
    expect(await screen.findByText('Usuario guardado')).toBeInTheDocument()
  })

  it('asigna el rol Técnico desde Editar usuario con la RPC (MSF-182, FR-042)', async () => {
    puedeEscribir.valor = true
    useContextoPanel.mockReturnValue({ contexto: null })
    responderListado([fila()])
    render(<UsuarioList />)

    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.mouseDown(within(dialogo).getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: 'Técnico' }))
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('cambiar_rol_miembro', { p_target_user_id: 'u-1', p_nuevo_rol: 'tecnico' }))
    expect(await screen.findByText('Usuario guardado')).toBeInTheDocument()
  })

  it('muestra el correo en «Editar usuario» y envía el enlace con «Restablecer contraseña»', async () => {
    puedeEscribir.valor = true
    useContextoPanel.mockReturnValue({ contexto: null })
    resetPasswordForEmail.mockResolvedValue({ error: null })
    responderListado([fila()])
    render(<UsuarioList />)

    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    const dialogo = await screen.findByRole('dialog')
    expect(within(dialogo).getByText('ana@example.com')).toBeInTheDocument()
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Restablecer contraseña' }))

    await waitFor(() => expect(resetPasswordForEmail).toHaveBeenCalledWith('ana@example.com', expect.objectContaining({ redirectTo: expect.stringContaining('recuperacion') })))
    expect(await screen.findByText('Enviamos el enlace para restablecer la contraseña')).toBeInTheDocument()
  })

  it('no ofrece acciones sobre la fila propia', async () => {
    puedeEscribir.valor = true
    useContextoPanel.mockReturnValue({ contexto: null })
    responderListado([fila({ es_propio: true })])
    render(<UsuarioList />)

    await waitFor(() => expect(screen.getByText('Ana Pérez')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remover' })).not.toBeInTheDocument()
  })

  it('remueve tras confirmar en un diálogo, sin window.confirm', async () => {
    puedeEscribir.valor = true
    useContextoPanel.mockReturnValue({ contexto: null })
    responderListado([fila()])
    render(<UsuarioList />)

    fireEvent.click(await screen.findByRole('button', { name: 'Remover' }))
    const dialogo = await screen.findByRole('dialog')
    expect(rpc).not.toHaveBeenCalledWith('remover_miembro', expect.anything())
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Remover' }))

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('remover_miembro', { p_target_user_id: 'u-1' }))
    expect(await screen.findByText('Usuario removido')).toBeInTheDocument()
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

  it('recorre editar rol, suspender y reactivar contra un listado con estado (flujo de T036)', async () => {
    puedeEscribir.valor = true
    useContextoPanel.mockReturnValue({ contexto: null })
    const usuario = fila()
    rpc.mockImplementation(async (nombre: string, args?: { p_nuevo_rol?: string }) => {
      if (nombre === 'cambiar_rol_miembro') usuario.rol_id = args?.p_nuevo_rol ?? usuario.rol_id
      if (nombre === 'suspender_miembro') usuario.estado = 'suspendido'
      if (nombre === 'reactivar_miembro') usuario.estado = 'activo'
      return { data: nombre === 'listar_usuarios_organizacion' ? [{ ...usuario }] : null, error: null }
    })
    render(<UsuarioList />)

    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    let dialogo = await screen.findByRole('dialog')
    fireEvent.mouseDown(within(dialogo).getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: 'Depósito' }))
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Usuario guardado')).toBeInTheDocument()
    expect(await screen.findByText('Depósito')).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: 'Suspender' }))
    dialogo = await screen.findByRole('dialog')
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Suspender' }))
    expect(await screen.findByText('Usuario suspendido')).toBeInTheDocument()
    expect(await screen.findByText('Suspendido')).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: 'Reactivar' }))
    expect(await screen.findByText('Usuario reactivado')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Suspendido')).not.toBeInTheDocument())
    expect(rpc.mock.calls.map(([nombre]) => nombre).filter((n) => !['listar_usuarios_organizacion', 'listar_empresas_usuarios', 'empresas_para_selector'].includes(n as string))).toEqual(['cambiar_rol_miembro', 'suspender_miembro', 'reactivar_miembro'])
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

    const dialogo = screen.getByRole('dialog')
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('La organización debe conservar al menos un administrador')
  })

  it('muestra el error de «Restablecer contraseña» dentro del diálogo y no lo duplica en la página', async () => {
    puedeEscribir.valor = true
    useContextoPanel.mockReturnValue({ contexto: null })
    resetPasswordForEmail.mockResolvedValue({ error: { message: 'x' } })
    responderListado([fila()])
    render(<UsuarioList />)

    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Restablecer contraseña' }))

    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('No pudimos enviar el enlace')
    expect(screen.getAllByText(/No pudimos enviar el enlace/)).toHaveLength(1)
  })

  it('no envía el enlace a un suspendido y pide reactivarlo primero (FR-006)', async () => {
    puedeEscribir.valor = true
    useContextoPanel.mockReturnValue({ contexto: null })
    responderListado([fila({ estado: 'suspendido' })])
    render(<UsuarioList />)

    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    const dialogo = await screen.findByRole('dialog')
    expect(within(dialogo).getByText(/Reactivalo antes de enviarle el enlace/)).toBeInTheDocument()
    expect(within(dialogo).getByRole('button', { name: 'Restablecer contraseña' })).toBeDisabled()
    expect(resetPasswordForEmail).not.toHaveBeenCalled()
  })

  it('no ofrece «Restablecer contraseña» a quien no es administrador ni sobre la fila propia (FR-007)', async () => {
    puedeEscribir.valor = false
    useContextoPanel.mockReturnValue({ contexto: null })
    responderListado([fila()])
    const { unmount } = render(<UsuarioList />)
    await screen.findByText('Ana Pérez')
    expect(screen.queryByRole('button', { name: /Editar|Restablecer contraseña/ })).toBeNull()
    unmount()

    puedeEscribir.valor = true
    responderListado([fila({ es_propio: true })])
    render(<UsuarioList />)
    await screen.findByText('Ana Pérez')
    expect(screen.queryByRole('button', { name: /Editar|Restablecer contraseña/ })).toBeNull()
  })
  describe('empresas y rol por empresa (F-ROL-07)', () => {
    const empresasSelector = [
      { id: 'emp-a', nombre: 'San Javucho', es_activa: true, rol_id: 'administrador' },
      { id: 'emp-b', nombre: 'Mundo JC', es_activa: false, rol_id: 'administrador' },
    ]
    const preparar = (asignaciones: unknown[] = [], rol = 'operador') => {
      puedeEscribir.valor = true
      useContextoPanel.mockReturnValue({ contexto: null })
      rpc.mockImplementation(async (nombre: string) => {
        if (nombre === 'listar_usuarios_organizacion') return { data: [fila({ rol_id: rol })], error: null }
        if (nombre === 'listar_empresas_usuarios') return { data: asignaciones, error: null }
        if (nombre === 'empresas_para_selector') return { data: empresasSelector, error: null }
        return { data: null, error: null }
      })
    }
    const asignadas = [
      { user_id: 'u-1', empresa_id: 'emp-a', empresa_nombre: 'San Javucho', rol_id: 'operador' },
      { user_id: 'u-1', empresa_id: 'emp-b', empresa_nombre: 'Mundo JC', rol_id: 'consulta' },
    ]

    it('la lista muestra tiendas y rol por tienda', async () => {
      preparar(asignadas)
      render(<UsuarioList />)

      expect(await screen.findByText('San Javucho: Operador')).toBeInTheDocument()
      expect(screen.getByText('Mundo JC: Consulta')).toBeInTheDocument()
    })

    it('el Administrador figura con todas las empresas, sin asignaciones', async () => {
      preparar([], 'administrador')
      render(<UsuarioList />)

      expect(await screen.findByText('Todas las empresas')).toBeInTheDocument()
    })

    it('Editar precarga las empresas del usuario y guarda el reemplazo con la RPC atómica', async () => {
      preparar(asignadas)
      render(<UsuarioList />)

      fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
      const dialogo = await screen.findByRole('dialog')
      const marcadaA = await within(dialogo).findByRole('checkbox', { name: 'San Javucho' })
      expect(marcadaA).toBeChecked()
      expect(within(dialogo).getByRole('combobox', { name: 'Rol en Mundo JC' })).toBeInTheDocument()
      expect(within(dialogo).getByRole('button', { name: 'Guardar' })).toBeDisabled()

      fireEvent.click(within(dialogo).getByRole('checkbox', { name: 'Mundo JC' }))
      fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))

      await waitFor(() => expect(rpc).toHaveBeenCalledWith('asignar_empresas_usuario', {
        p_target_user_id: 'u-1',
        p_asignaciones: [{ empresa_id: 'emp-a', rol_id: 'operador' }],
      }))
      expect(rpc).not.toHaveBeenCalledWith('cambiar_rol_miembro', expect.anything())
      expect(await screen.findByText('Usuario guardado')).toBeInTheDocument()
    })

    it('una empresa asignada que no vino en la lista sigue visible para poder desmarcarla', async () => {
      preparar([{ user_id: 'u-1', empresa_id: 'emp-z', empresa_nombre: 'Vieja', rol_id: 'operador' }])
      render(<UsuarioList />)

      fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
      const dialogo = await screen.findByRole('dialog')
      expect(await within(dialogo).findByRole('checkbox', { name: 'Empresa no disponible' })).toBeChecked()
    })

    it('elegir Administrador indica que accede a todas las empresas y quita las asignaciones', async () => {
      preparar(asignadas)
      render(<UsuarioList />)

      fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
      const dialogo = await screen.findByRole('dialog')
      fireEvent.mouseDown(within(dialogo).getByRole('combobox', { name: 'Rol' }))
      fireEvent.click(await screen.findByRole('option', { name: 'Administrador' }))

      expect(within(dialogo).getByText(/accede a todas las empresas/)).toBeInTheDocument()
      expect(within(dialogo).queryByRole('checkbox')).not.toBeInTheDocument()
      fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))

      await waitFor(() => expect(rpc).toHaveBeenCalledWith('asignar_empresas_usuario', { p_target_user_id: 'u-1', p_asignaciones: [] }))
      expect(rpc).toHaveBeenCalledWith('cambiar_rol_miembro', { p_target_user_id: 'u-1', p_nuevo_rol: 'administrador' })
    })

    it('si no cargan las asignaciones avisa y no deja editar (no hay reemplazo a ciegas)', async () => {
      preparar(asignadas)
      const base = rpc.getMockImplementation()!
      rpc.mockImplementation(async (nombre: string, args?: unknown) =>
        nombre === 'listar_empresas_usuarios' ? { data: null, error: { message: 'falló' } } : base(nombre, args))
      render(<UsuarioList />)

      expect(await screen.findByText('No pudimos cargar las empresas')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Editar' })).toBeDisabled()
    })

    it('muestra el error de la base si rechaza la asignación', async () => {
      preparar(asignadas)
      const base = rpc.getMockImplementation()!
      rpc.mockImplementation(async (nombre: string, args?: unknown) =>
        nombre === 'asignar_empresas_usuario' ? { data: null, error: { message: 'No puede gestionar usuarios de esta organización' } } : base(nombre, args))
      render(<UsuarioList />)

      fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
      const dialogo = await screen.findByRole('dialog')
      fireEvent.click(await within(dialogo).findByRole('checkbox', { name: 'Mundo JC' }))
      fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))

      expect(await within(dialogo).findByText('No puede gestionar usuarios de esta organización')).toBeInTheDocument()
    })
  })
})
