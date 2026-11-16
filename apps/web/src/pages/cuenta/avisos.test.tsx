import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc } }))

import { notificarEmpresaActivaCambiada } from '../../lib/empresaActivaRevision'
import { AvisosPage } from './avisos'

const CONSULTA_NUEVA = { tipo: 'consulta_nueva', nombre: 'Consulta nueva', activo: true }

function respuestas(listado: unknown[], guardado: { error: { code?: string; message?: string } | null } = { error: null }) {
  rpc.mockImplementation(async (nombre: string) => {
    if (nombre === 'listar_preferencias_aviso') return { data: listado, error: null }
    return { data: null, ...guardado }
  })
}

describe('AvisosPage', () => {
  beforeEach(() => {
    rpc.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('lista el tipo de aviso del rol con su interruptor encendido por defecto', async () => {
    respuestas([CONSULTA_NUEVA])
    render(<AvisosPage />)
    const interruptor = await screen.findByRole('checkbox', { name: 'Consulta nueva' })
    expect(interruptor).toBeChecked()
    expect(screen.getByRole('heading', { level: 1, name: 'Avisos por correo' })).toBeInTheDocument()
    expect(rpc).toHaveBeenCalledWith('listar_preferencias_aviso')
  })

  it('un rol sin tipos de aviso ve el estado vacío, sin interruptores', async () => {
    respuestas([])
    render(<AvisosPage />)
    expect(await screen.findByText('Todavía no tenés avisos para configurar')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('muestra el estado de carga mientras llega la lista', () => {
    rpc.mockReturnValue(new Promise(() => undefined))
    render(<AvisosPage />)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByText('Todavía no tenés avisos para configurar')).not.toBeInTheDocument()
  })

  it('apagar un tipo guarda la preferencia y lo confirma en pantalla', async () => {
    respuestas([CONSULTA_NUEVA])
    render(<AvisosPage />)
    const interruptor = await screen.findByRole('checkbox', { name: 'Consulta nueva' })
    fireEvent.click(interruptor)
    expect(await screen.findByRole('status')).toHaveTextContent('Dejaste de recibir los avisos de «Consulta nueva» por correo.')
    expect(rpc).toHaveBeenCalledWith('guardar_preferencia_aviso', { p_tipo: 'consulta_nueva', p_activo: false })
    expect(screen.getByRole('checkbox', { name: 'Consulta nueva' })).not.toBeChecked()
  })

  it('volver a encender un tipo lo confirma', async () => {
    respuestas([{ ...CONSULTA_NUEVA, activo: false }])
    render(<AvisosPage />)
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Consulta nueva' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Vas a recibir los avisos de «Consulta nueva» por correo.')
    expect(rpc).toHaveBeenCalledWith('guardar_preferencia_aviso', { p_tipo: 'consulta_nueva', p_activo: true })
  })

  it('si no se pudo guardar avisa con un mensaje claro y el interruptor no cambia', async () => {
    respuestas([CONSULTA_NUEVA], { error: { message: 'boom' } })
    render(<AvisosPage />)
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Consulta nueva' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos guardar tu preferencia.')
    expect(screen.getByRole('checkbox', { name: 'Consulta nueva' })).toBeChecked()
  })

  it('si el tipo no es visible para el usuario lo dice y no cambia el interruptor', async () => {
    respuestas([CONSULTA_NUEVA], { error: { code: '42501', message: 'sin acceso' } })
    render(<AvisosPage />)
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Consulta nueva' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No tenés acceso a este tipo de aviso')
    expect(screen.getByRole('checkbox', { name: 'Consulta nueva' })).toBeChecked()
  })

  it('un error de carga ofrece reintentar', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'caída' } })
    render(<AvisosPage />)
    expect(await screen.findByText('No pudimos cargar tus avisos.')).toBeInTheDocument()
    respuestas([CONSULTA_NUEVA])
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('checkbox', { name: 'Consulta nueva' })).toBeInTheDocument()
  })

  it('no ofrece los avisos de seguridad de la cuenta', async () => {
    respuestas([CONSULTA_NUEVA])
    render(<AvisosPage />)
    await screen.findByRole('checkbox', { name: 'Consulta nueva' })
    const interruptores = screen.getAllByRole('checkbox')
    expect(interruptores).toHaveLength(1)
    expect(screen.queryByRole('checkbox', { name: /invitaci|contrase|recuperar|seguridad/i })).not.toBeInTheDocument()
  })

  it('es operable con teclado y lector: cada interruptor tiene nombre y la lista está rotulada', async () => {
    respuestas([CONSULTA_NUEVA])
    render(<AvisosPage />)
    const interruptor = await screen.findByRole('checkbox', { name: 'Consulta nueva' })
    expect(within(screen.getByRole('region', { name: 'Tipos de aviso' })).getByRole('checkbox', { name: 'Consulta nueva' })).toBe(interruptor)
    interruptor.focus()
    expect(interruptor).toHaveFocus()
    expect(interruptor).not.toBeDisabled()
  })

  it('cambiar la empresa activa de la barra superior no recarga ni altera la pantalla (SC-005)', async () => {
    respuestas([CONSULTA_NUEVA])
    render(<AvisosPage />)
    await screen.findByRole('checkbox', { name: 'Consulta nueva' })
    const llamadas = rpc.mock.calls.length
    act(() => notificarEmpresaActivaCambiada())
    await waitFor(() => expect(rpc.mock.calls.length).toBe(llamadas))
    expect(screen.getByRole('checkbox', { name: 'Consulta nueva' })).toBeChecked()
  })
})
