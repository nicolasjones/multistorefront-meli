import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { DialogoCorreoSeleccionados } from './DialogoCorreoSeleccionados'

const abrir = (extra: Partial<Parameters<typeof DialogoCorreoSeleccionados>[0]> = {}) => {
  const props = { open: true, clientes: ['c-1', 'c-2', 'c-3'], empresaId: 'e-1', onCerrar: vi.fn(), onEnviado: vi.fn(), ...extra }
  render(<DialogoCorreoSeleccionados {...props} />)
  return props
}

// FR-011: el diálogo reproduce el prototipo (título, texto, campos y botones literales).
describe('DialogoCorreoSeleccionados', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rpc.mockResolvedValue({ data: 'campana-1', error: null })
  })

  it('muestra el título, el texto con N, los campos Asunto y Mensaje y los botones Cancelar y Enviar correo', () => {
    abrir()
    expect(screen.getByRole('dialog', { name: 'Enviar correo a seleccionados' })).toBeInTheDocument()
    expect(screen.getByText('Se envía a los 3 clientes marcados en el listado. Solo reciben el correo quienes tienen un mail cargado y aceptan el correo masivo.')).toBeInTheDocument()
    expect(screen.getByLabelText(/Asunto/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Mensaje/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enviar correo' })).toBeInTheDocument()
  })

  it('asunto y mensaje son obligatorios: no envía y marca los campos', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar correo' }))
    expect(await screen.findByText('El asunto es obligatorio.')).toBeInTheDocument()
    expect(screen.getByText('El mensaje es obligatorio.')).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('envía solo a los marcados con la empresa activa y avisa cuántos eran', async () => {
    const props = abrir()
    fireEvent.change(screen.getByLabelText(/Asunto/), { target: { value: '  Ofertas ' } })
    fireEvent.change(screen.getByLabelText(/Mensaje/), { target: { value: 'Hola' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar correo' }))
    await waitFor(() => expect(props.onEnviado).toHaveBeenCalledWith(3))
    expect(mocks.rpc).toHaveBeenCalledWith('crear_campana_correo', {
      p_clave: expect.stringMatching(/^[0-9a-f-]{36}$/), p_asunto: 'Ofertas', p_mensaje: 'Hola', p_empresa: 'e-1',
      p_texto: null, p_tipo: null, p_con_cuenta_web: false, p_clientes: ['c-1', 'c-2', 'c-3'],
    })
  })

  it('un error muestra un mensaje claro y el reintento usa la misma clave (no crea dos campañas)', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', hint: 'sin_destinatarios', message: 'x' } })
    const props = abrir()
    fireEvent.change(screen.getByLabelText(/Asunto/), { target: { value: 'Ofertas' } })
    fireEvent.change(screen.getByLabelText(/Mensaje/), { target: { value: 'Hola' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar correo' }))
    expect(await screen.findByText(/No hay clientes elegibles/)).toBeInTheDocument()
    expect(props.onEnviado).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Enviar correo' }))
    await waitFor(() => expect(props.onEnviado).toHaveBeenCalled())
    expect(mocks.rpc.mock.calls[0][1].p_clave).toBe(mocks.rpc.mock.calls[1][1].p_clave)
  })

  it('«Cancelar» cierra sin enviar nada', () => {
    const props = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(props.onCerrar).toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
